# Group Tabs By Domain

Check out the "Group Tabs By Domain" extension! It keeps your browser organized by automatically grouping tabs based on their website domain.

## Key Features

- **Auto-Grouping**: Automatically groups tabs from the same domain together (e.g., all `google.com` tabs in one group, `github.com` in another).
- **Smart Focus**:
  - When you click a tab, its group expands.
  - All other groups automatically collapse to save space.
  - **Active Group on Right**: The active group moves to the right side of the tab strip, keeping all inactive (collapsed) groups neatly organized on the left.
- **Duplicate Prevention**: Robust logic ensures you don't get multiple groups for the same domain, even when opening many tabs at once or restarting the browser.
- **New Tab Handling**: Special handling for "New Tab" pages to keep them accessible.

## How it works

The extension runs in the background and listens for tab creation and updates. When a new URL is loaded, it checks if a group for that domain already exists in the window. If so, it adds the tab to it; if not, it creates a new group. It also manages group expansion and ordering to ensure a clean workspace.

## Installation

1. Open Chrome and navigate to `chrome://extensions/`.
2. Enable "Developer mode" in the top right corner.
3. Click "Load unpacked" and select the extension directory.

## Note on Duplicate Saved Tab Groups

While using this extension, you may occasionally notice **duplicate entries** for Saved Tab Groups (e.g., seeing two separate "BILIBILI" groups in your saved bar).

**The Phenomenon**
If you have a Saved Tab Group (e.g., "BILIBILI") that is currently **closed** (hidden from the tab strip and stored only in the bookmarks bar), opening a new Bilibili tab will cause the extension to create a **brand new** "BILIBILI" group, rather than restoring the previously closed one.

**Why this happens (Technical Limitation)**
This behavior is due to limitations in the current Chrome Extension API (`chrome.tabGroups`):

1.  **Cannot access closed groups:** Chrome's API currently only allows extensions to query groups that are **active** (visible on the tab strip).
2.  **Hidden groups are invisible:** Once a Saved Group is "closed" or "hidden," it becomes undetectable to the extension within the current session.
3.  **The Result:** Since the extension cannot "see" that a "BILIBILI" group already exists in your background storage, it assumes none exists and creates a new one to ensure your tab is properly grouped.
