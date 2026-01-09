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

let initialGroupingInProgress = false;

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

// Consolidate duplicate groups in the given window
async function consolidateGroups(windowId) {
  const groups = await chrome.tabGroups.query({ windowId });
  const map = new Map();

  // Group groups by title
  for (const g of groups) {
    if (!g.title) continue;
    if (!map.has(g.title)) {
      map.set(g.title, []);
    }
    map.get(g.title).push(g);
  }

  // Merge duplicates
  for (const [title, groupList] of map) {
    if (groupList.length > 1) {
      console.log(`[GTBD] Consolidating ${groupList.length} groups for '${title}' in window ${windowId}`);
      // Keep the first one, move others' tabs to it
      const targetGroup = groupList[0];
      const others = groupList.slice(1);
      
      for (const otherGroup of others) {
          try {
            const tabs = await chrome.tabs.query({ groupId: otherGroup.id });
            const tabIds = tabs.map(t => t.id);
            if (tabIds.length > 0) {
              await chrome.tabs.group({ groupId: targetGroup.id, tabIds });
            }
          } catch (e) {
            console.error("Error moving tabs during consolidation", e);
          }
      }
    }
  }
}

async function groupTab(tab, options = {}) {
  let domain;
  const { groupsCache } = options;

  // Handle "New Tab" specifically
  if (tab.url === "chrome://newtab/" || tab.url === "edge://newtab/") {
    domain = "TAB";
  } else {
    if (!tab || isSkippableUrl(tab.url)) return;
    domain = getDomain(tab.url);
  }

  if (!domain) return;

  const windowId = tab.windowId;

  // Check if tab is already in the correct group
  if (tab.groupId && tab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE) {
    try {
      const group = await chrome.tabGroups.get(tab.groupId);
      if (group.title === domain) {
        await collapseOthersExpandCurrent(windowId, tab.groupId);
        return;
      }
    } catch (e) {
      // Group might not exist anymore, proceed
    }
  }

  console.log(`[GTBD] Processing tab ${tab.id} ${tab.url}`);

  try {
    // Query groups in this window unless a cache was provided
    const allGroups = groupsCache || await chrome.tabGroups.query({ windowId });
    const existingGroup = allGroups.find(g => g.title === domain);

    let groupId;
    if (existingGroup) {
      // Add to existing group in the same window
      groupId = existingGroup.id;

      await chrome.tabs.group({
        groupId,
        tabIds: [tab.id],
      });

      // Collapse/expand in the group's window
      await collapseOthersExpandCurrent(windowId, groupId);
    } else {
      // Only create new group if no existing group with same name in this window
      groupId = await chrome.tabs.group({ tabIds: [tab.id] });
      await chrome.tabGroups.update(groupId, { title: domain, collapsed: true });
      if (groupsCache) {
        try {
          const newGroup = await chrome.tabGroups.get(groupId);
          groupsCache.push(newGroup);
        } catch (e) {
          console.error("Error updating groups cache", e);
        }
      }
      await collapseOthersExpandCurrent(windowId, groupId);
    }
  } catch (err) {
    console.error("Error in groupTab:", err);
  }
}

// Initial grouping: group all existing tabs (e.g., on install/startup)
async function groupAllTabsInAllWindows() {
  if (initialGroupingInProgress) return;
  initialGroupingInProgress = true;
  try {
    const windows = await chrome.windows.getAll({ populate: true });
    for (const w of windows) {
      // First, consolidate any mess
      await consolidateGroups(w.id);

      const windowGroups = await chrome.tabGroups.query({ windowId: w.id });
      for (const tab of w.tabs || []) {
        // Skip pinned tabs if you want; currently it groups pinned too.
        await groupTab(tab, { groupsCache: windowGroups });
      }
    }
  } finally {
    initialGroupingInProgress = false;
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
  if (initialGroupingInProgress) return;
  // Check if we should group this tab.
  // We pass it to groupTab which now handles the logic, but we need to ensure we call it.
  // Previously we checked isSkippableUrl here too.
  if (tab.url) {
     groupTab(tab).catch(console.error);
  }
});

// Key: regroup when URL changes (more reliable than only status=complete)
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (initialGroupingInProgress) return;
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
    }
  } catch (e) {
    console.error(e);
  }
});






