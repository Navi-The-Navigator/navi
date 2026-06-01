# Change Log

All notable changes to the "navi" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [Unreleased]

- Initial release
- Refactor: decomposed the `extension.ts` god-class into single-responsibility
  modules under `src/chat/` and `src/focus/`; split each webview into per-view
  `{ view, render, state, html }.ts`; renamed the "sidebar" chat view to "chat"
  throughout.
  - **State migration note:** the chat view type was renamed
    `navi.sidebarWebview` → `navi.chatWebview` and the activity-bar container
    `naviSidebar` → `navi`. VS Code keys webview-view layout (panel position)
    on these ids, so on first launch after this change the Navi views return to
    their default location and may need to be re-pinned/re-arranged once. No
    user data is lost — chat sessions are in-memory and the only persisted
    global-state key (`navi.confirmedEnvApiKey`) is unchanged.