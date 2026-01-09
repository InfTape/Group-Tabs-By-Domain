// Helper to extract group name from URL (remove www, TLD, uppercase)
function getDomain(url) {
  try {
    const { hostname } = new URL(url);

    // split hostname
    const parts = hostname
      .toLowerCase()
      .split(".")
      .filter(p => p !== "www");

    if (parts.length === 0) return null;

    // Common meaningless top-level domains
    const meaninglessTLD = new Set([
      "com", "net", "org", "cn", "io", "co", "edu", "gov"
    ]);

    // Find the first "informative" field from left to right
    for (const part of parts) {
      if (!meaninglessTLD.has(part)) {
        return part.toUpperCase();
      }
    }

    return null;
  } catch {
    return null;
  }
}


function isSkippableUrl(url) {
  if (!url) return true;
  if (url === "chrome://newtab/" || url === "edge://newtab/") return false; // Don't skip new tabs
  return (
    url.startsWith("chrome://") ||
    url.startsWith("edge://") ||
    url.startsWith("about:") ||
    url.startsWith("chrome-extension://") ||
    url.startsWith("file://")
  );
}

// Collapse all groups in a window except keepGroupId, and expand keepGroupId.
async function collapseOthersExpandCurrent(windowId, keepGroupId) {
  const allGroups = await chrome.tabGroups.query({ windowId });

  const jobs = [];
  for (const g of allGroups) {
    if (g.id === keepGroupId) {
      if (g.collapsed) jobs.push(chrome.tabGroups.update(g.id, { collapsed: false }));
      jobs.push(chrome.tabGroups.move(g.id, { index: -1 }));
    } else {
      if (!g.collapsed) jobs.push(chrome.tabGroups.update(g.id, { collapsed: true }));
    }
  }
  await Promise.allSettled(jobs);
}

async function ensureGroupForDomain(windowId, domain, color) {
  // Try to find existing group by exact title in same window
  const groups = await chrome.tabGroups.query({ windowId, title: domain });
  if (groups.length > 0) return groups[0].id;

  // Create empty group by grouping a tab later; but chrome.tabs.group needs tabIds.
  // So: caller will create group with tabIds and then update title.
  return null;
}


const groupCreationLocks = new Map();

async function groupTab(tab) {
  let domain;

  // Handle "New Tab" specifically
  if (tab.url === "chrome://newtab/" || tab.url === "edge://newtab/") {
    domain = "tab";
  } else {
    if (!tab || isSkippableUrl(tab.url)) return;
    domain = getDomain(tab.url);
  }

  if (!domain) return;
  
  const windowId = tab.windowId;

  // Optimization: Check if tab is already in the correct group
  if (tab.groupId && tab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE) {
    try {
      const group = await chrome.tabGroups.get(tab.groupId);
      if (group.title === domain) {
        // Tab is already in the correct group. Just ensure ordering and return.
        await collapseOthersExpandCurrent(windowId, tab.groupId);
        return;
      }
    } catch (e) {
      // Group might not exist anymore, proceed
    }
  }

  console.log(`[GTBD] Processing tab ${tab.id} ${tab.url}`);

  const lockKey = `${windowId}:${domain}`;
  
  // Chain promises to ensure sequential processing for same domain
  const previousPromise = groupCreationLocks.get(lockKey) || Promise.resolve();
  
  const currentPromise = previousPromise.then(async () => {
    try {
      // Find existing group in same window
      const groups = await chrome.tabGroups.query({ title: domain, windowId });

      let groupId;
      if (groups.length > 0) {
        groupId = groups[0].id;

        // Add to existing group
        await chrome.tabs.group({
          groupId,
          tabIds: [tab.id],
        });
      } else {
        // Create new group with this tab
        groupId = await chrome.tabs.group({ tabIds: [tab.id] });
        // Auto-collapse new groups
        await chrome.tabGroups.update(groupId, { title: domain, collapsed: true });
      }

      // Only expand current domain group, collapse others (same window)
      await collapseOthersExpandCurrent(windowId, groupId);
    } catch (err) {
      console.error('Error in grouped logic:', err);
    }
  });

  // store the new promise
  groupCreationLocks.set(lockKey, currentPromise);

  // cleanup after myself if I'm the last one (optional, but good for memory)
  // relying on the Map to not grow indefinitely for unique domains is probably fine for now
  // but let's clear it when chain is done to avoid memory leaks over long sessions
  currentPromise.finally(() => {
    if (groupCreationLocks.get(lockKey) === currentPromise) {
      groupCreationLocks.delete(lockKey);
    }
  });

  await currentPromise;
}

// Initial grouping: group all existing tabs (e.g., on install/startup)
async function groupAllTabsInAllWindows() {
  const windows = await chrome.windows.getAll({ populate: true });
  for (const w of windows) {
    for (const tab of w.tabs || []) {
      // Skip pinned tabs if you want; currently it groups pinned too.
      await groupTab(tab);
    }
  }
}

// ---- Event listeners ----

// On install / update
chrome.runtime.onInstalled.addListener(() => {
  groupAllTabsInAllWindows().catch(console.error);
});

// On browser startup
chrome.runtime.onStartup.addListener(() => {
  groupAllTabsInAllWindows().catch(console.error);
});

// When a tab is created, URL might be empty or newtab; we rely on onUpdated(url) mainly.
chrome.tabs.onCreated.addListener((tab) => {
  // Check if we should group this tab.
  // We pass it to groupTab which now handles the logic, but we need to ensure we call it.
  // Previously we checked isSkippableUrl here too.
  if (tab.url) {
     groupTab(tab).catch(console.error);
  }
});

// Key: regroup when URL changes (more reliable than only status=complete)
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  // If the URL changed, we can act immediately
  if (changeInfo.url) {
    groupTab({ ...tab, url: changeInfo.url }).catch(console.error);
    return;
  }

  // Fallback: when load completes (some cases URL isn't in changeInfo)
  if (changeInfo.status === "complete") {
    groupTab(tab).catch(console.error);
  }
});

// Optional: when user activates a tab, expand its group and collapse others
chrome.tabs.onActivated.addListener(async ({ tabId, windowId }) => {
  try {
    const tab = await chrome.tabs.get(tabId);
    // If it's grouped, use that group; else ignore
    if (tab.groupId && tab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE) {
      await collapseOthersExpandCurrent(windowId, tab.groupId);
    } else if (tab.url && !isSkippableUrl(tab.url)) {
      // If ungrouped but has a normal URL, group it (optional behavior)
      await groupTab(tab);
    }
  } catch (e) {
    console.error(e);
  }
});
