# Group Administration Assistant

Group Administration Assistant brings moderation, group administration and subgroup creation together for each managed scope. It requires WABP core API 0.3.29. WhatsApp help and responses are available in English and European Portuguese.

On the console’s Access page, assign **Group Admin** to people who moderate members and manage group information. **Community Admin** also grants group settings, structural changes and permission to send as the bot. Reports go privately to the people holding the moderation permission in that scope.

Members can reply to a message with `/report` and use `/group create` under the scope’s creation policy. A member may use `/admin title`, `description`, `pin` or `unpin` when WhatsApp lets all members edit group information. Administrators use `/admin` for group actions, cases, suspensions and expulsions.

A suspension removes a member for its duration and then attempts to add them back. An expulsion lasts until lifted. Join approval can be required for covered groups. Automatic approval, when enabled, admits people without a hold while the raid shield is inactive. The moderation settings start with dry run enabled. The plugin retains the moderation case database and provides the subgroup creation service used by Community Events.

Source history for Moderation, Do As and Community Subgroups is recorded in `provenance.json`. Public release archives are built by the repository’s Release standalone plugin workflow.
