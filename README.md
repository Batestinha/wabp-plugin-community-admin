# Group Administration Assistant

Manages group membership, join requests, settings and subgroups. Administrators with the appropriate role can moderate messages, review reports, warn members, and suspend or expel them. It requires WABP core API 0.3.29. WhatsApp help and responses are available in English and European Portuguese.

On the console’s Access page, assign **Group Admin** to people who moderate members and manage group information. **Community Admin** also grants group settings, structural changes and permission to send as the bot. Reports go privately to the people holding the moderation permission in that scope.

Members can reply to a message with `/report` and use `/group create` under the scope’s creation policy. A member may use `/admin title`, `description`, `pin` or `unpin` when WhatsApp lets all members edit group information. Administrators use `/admin` for group actions, cases, suspensions and expulsions.

A suspension removes a member for its duration and then attempts to add them back. An expulsion lasts until lifted. Join approval applies to managed standalone groups and directly joinable community subgroups. The community parent and its linked announcement group reflect subgroup membership. Automatic approval, when enabled, admits people without a hold while the raid shield is inactive. The moderation settings start with dry run enabled. The plugin retains the moderation case database and provides the subgroup creation service used by Community Events.

In **Group rules**, add rules in the order members should read them. Each rule has an ID, member-facing wording and optional moderation checks. Linked checks use the configured moderation policy, mode and dry run. Members can report other violations for moderator review. `/rules` and Onboarding’s welcome both use this published rulebook. When old Onboarding wording conflicts with an existing rulebook, the settings retain it for review.

Source history for Moderation, Do As and Community Subgroups is recorded in `provenance.json`. Public release archives are built by the repository’s Release standalone plugin workflow.
