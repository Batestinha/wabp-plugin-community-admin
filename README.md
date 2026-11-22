# Moderation

A WABS plugin for WABP. It keeps a scope's groups safe, whether the scope is a WhatsApp community with sub-groups or one or more standalone groups.

- **Suspend** a member for a number of days. They are removed from every group the scope covers, kept out while the suspension lasts, and added back when it ends (by invitation when their privacy settings block adding).
- **Expel** a member. They are removed from every group and kept out until a moderator lifts it.
- **Reports:** members reply to a message with `/report`; the moderators get it privately and act with `/mod resolve`.
- **Spam and raid shield:** invite links, unwanted links, banned phrases and floods; the only thing the bot does on its own is expel obvious spam from members who joined recently. Mass joins lock the group for a while.
- **Etiquette rules:** sticker bursts, forwarded chains, media in chosen groups and quiet hours. All off by default.

Suspensions and expulsions are recorded with the host as member standings (`member.setStanding`, WABP core API 0.3.24). The host decides what a standing means for its own features; this plugin only removes, re-adds and records. Everything starts with `enabled=false` and `dryRun=true`, which only writes decisions to the audit log.

**Who moderates.** The moderators are the people the host allows to use `plugin.moderation.manage` in the scope. The account owner and subowners always may. Anyone else is chosen by an operator: in WABP's console, on the Access page, give the person an "always allow" for `plugin.moderation.manage` in that scope, or a role that includes it. Nobody needs to be a WhatsApp group admin.
- Moderators get the reports and alerts privately, never the bot itself.
- The automatic rules never act on them.
- This needs WABP core API 0.3.26 (`permissionHoldersForScope`). On older hosts the alerts go to the WhatsApp admins of the authority groups instead.

**Also require WhatsApp admin** (`requireGroupAdmin`, off by default) adds a condition: moderators must also be WhatsApp admins of the authority groups. Those are the configured groups, otherwise the community group, otherwise the group where the command runs.

The bot, its owner and subowners are never moderated.

Commands: `/mod status|suspend|expel|lift|extend|cases|warn|pardon|warnings|lock|unlock|test|resolve` and `/report`. Translations: English and European Portuguese.
