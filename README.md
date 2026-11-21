# Moderation

A WABS plugin for WABP. It keeps a scope's groups safe, whether the scope is a WhatsApp community with sub-groups or one or more standalone groups.

- **Suspend** a member for a number of days. They are removed from every group the scope covers, kept out while the suspension lasts, and added back when it ends (by invitation when their privacy settings block adding).
- **Expel** a member. They are removed from every group and kept out until an admin lifts it.
- **Reports:** members reply to a message with `/report`; the admins get it privately and act with `/mod resolve`.
- **Spam and raid shield:** invite links, unwanted links, banned phrases and floods; the only thing the bot does on its own is expel obvious spam from members who joined recently. Mass joins lock the group for a while.
- **Etiquette rules:** sticker bursts, forwarded chains, media in chosen groups and quiet hours. All off by default.

Suspensions and expulsions are recorded with the host as member standings (`member.setStanding`, WABP core API 0.3.24). The host decides what a standing means for its own features; this plugin only removes, re-adds and records. Everything starts with `enabled=false` and `dryRun=true`, which only writes decisions to the audit log.

Only admins of the authority groups may moderate: by default the community group when there is one, otherwise the admins of the group where the command runs. The bot, its owner and subowners are never moderated.

Commands: `/mod status|suspend|expel|lift|extend|cases|warn|pardon|warnings|lock|unlock|test|resolve` and `/report`. Translations: English and European Portuguese.
