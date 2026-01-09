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
