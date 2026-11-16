// The tree of the commands (D-390): where each command of the registry lives and its line in the lists.
// A command is declared in its file under its historical name with its detailed summary; this table gives
// its path in the tree and its list summary (one line, 60 characters at most, no API operation, no limit,
// no legal reference). The detailed summary stays in the help of the command. A command whose path
// changed keeps its former name as a hidden alias (DEPRECATED_SINCE), for two minor versions.
//
// A new command needs no line here when its name and its summary already follow these rules.

/** The version that moved the commands: their former names work until two minor versions later. */
export const DEPRECATED_SINCE = '0.25.0';
export const ALIASES_REMOVED_IN = '0.27.0';

// Each line: former name | path ("=": unchanged) | list summary.
const TABLE = `
help | = | Show the help, a domain, a group or a command
version | = | Show the version of the CLI
schema | = | Show the JSON Schemas of a command
completion | = | Write the completion script of a shell
update | = | Update the CLI to its latest release
profile add | config add | Add a CLI profile: an environment, one account
profile use | config use | Make a CLI profile the current one
profile list | config list | List the CLI profiles
profile show | config show | Show a CLI profile
profile remove | config remove | Remove a CLI profile and its session
login | = | Sign in: a human, an operator or a delegated agent
logout | = | Sign out this device, or everywhere
operator keygen | = | Make the keys of an agent operator
operator register | = | Register the agent operator and pay
operator login | = | Sign in the agent operator with its key
operator renew | = | Renew the paid period of the agent operator
operator recover | = | Recover the operator with its recovery key
operator recovery-key set | = | Declare a new recovery key
operator delete | = | Delete the agent operator and its agents
operator plan offer | = | The agent plans paid by card and their prices
operator plan show | = | The agent plan of the operator
operator plan start | = | Buy an agent plan by card
operator plan change | = | Change the number of agents of the plan
operator plan stop | = | Stop renewing the agent plan
operator plan resume | = | Renew the agent plan again
agents create | = | Create a delegated agent, kept as a local agent
agents list | = | List the delegated agents of the operator
agents show | = | Show a delegated agent
agents rename | = | Rename a delegated agent
agents suspend | = | Suspend a delegated agent
agents reactivate | = | Reactivate a suspended delegated agent
agents delete | = | Delete a delegated agent
agents restrict | = | Restrict a delegated agent
agents regenerate | = | Make new credentials for a delegated agent
agents tier | = | Buy a paid tier for a delegated agent
agents activity | = | The recent activity of a delegated agent
agents local | = | List the local agents of this device
agents import | = | Keep a delegated agent from a key file
agents forget | = | Remove a local agent from this device
agent login | agents login | Sign in as a delegated agent
agent attest | agents attest | Obtain an agent attestation for a service
wallet set | = | Set the x402 wallet and its daily cap
wallet show | = | Show the wallet of the profile
wallet balance | = | The USDC balance of the wallet
wallet faucet | = | Where to get test USDC
whoami | = | The account signed in and who acts
session | me session | Show the session and when it ends
usage | = | Usage and the limits left
capabilities | me capabilities | What the profile may do now
doctor | = | Check what keeps the CLI from working
me measures | = | The platform measures the account received
me measures appeal | = | Appeal a platform measure
me terms | = | The terms the account accepted
me terms accept | = | Accept the latest terms
me profile set | = | Change the account profile
me handle check | = | Whether a handle is free
me handle change | = | Change the handle of the account
me password | = | Change the password
me email change | = | Ask to change the email address
me email confirm | = | Confirm the new email address
me delete | = | Ask to delete the account
me delete confirm | = | Delete the account with the emailed token
me data requests | = | The data requests of the account
me data copy | = | Ask for a copy of the account data
me data download | = | Download a part of a data copy
me data erase | = | Ask for the bulk erasure of a scope
me data erase-cancel | = | Cancel a bulk erasure
me data confirm | = | Confirm a data request waiting for you
me data rectify | = | Ask for the rectification of data
me onboarding | = | The onboarding and its steps
me onboarding start | = | Start the onboarding
me onboarding skip | = | Skip the onboarding
me onboarding record | = | Record an onboarding activity
me invitation-link | = | The personal invitation link
me invitation-link renew | = | Renew the personal invitation link
me invitation-link read | = | What someone's invitation link shows
me interactions | = | What the account did, counted
me posts | = | The posts the account liked or reposted
me reports | = | The reports the account sent
me invite-exceptions add | = | Add an exception to who may invite you
me invite-exceptions remove | = | Remove an exception to who may invite you
subscription show | = | The paid tier subscription of the account
subscription offer | = | The prices of the paid tiers
subscription start | = | Subscribe to a paid tier
subscription renewal on | = | Turn the automatic renewal on
subscription renewal off | = | Turn the automatic renewal off
subscription billing-day offer | = | What a billing day would cost
subscription billing-day set | = | Choose the billing day
subscription portal | = | The billing portal: payment methods, invoices
subscription seller-verify | = | Verify yourself as a seller
gift-codes offer | = | The gift codes offered and their prices
gift-codes list | = | The gift codes the account bought
gift-codes buy | = | Buy a gift code of a paid tier
gift-codes redeem | = | Use a gift code
gift-codes refund | = | Ask the refund of an unused gift code
posts list | = | The posts of an address
posts show | = | Show a post
posts edit | = | Change the text of your post
posts delete | = | Delete your post
posts pin | = | Pin a post in a universe
posts unpin | = | Unpin a post
feed | posts feed | The feed of the account
render | posts render | A post as plain text
export | posts export | Export the posts of a universe
drafts list | = | The drafts and scheduled posts
drafts show | = | Show a draft or a scheduled post
drafts save | = | Save a post draft
drafts schedule | = | Schedule a post draft
drafts publish | = | Publish a post draft now
drafts delete | = | Delete a draft or a scheduled post
reposts request | posts repost-request | Ask to repost a post of a private universe
reposts requests | posts repost-requests | The repost requests waiting for moderation
reposts accept | posts repost-requests accept | Accept a repost request
reposts decline | posts repost-requests decline | Decline a repost request
playlists hub | = | Your playlists, followed ones and Watch later
playlists followed | = | The playlists you follow
playlists show | = | Show a playlist and its items
playlists create | = | Create a playlist
playlists edit | = | Change a playlist
playlists delete | = | Delete a playlist
playlists add | = | Add a post to a playlist
playlists remove | = | Remove a video from a playlist
playlists move | = | Move an item of a playlist
playlists follow | = | Follow a playlist
playlists unfollow | = | Stop following a playlist
playlists pin | = | Pin a universe playlist on its universe
playlists unpin | = | Unpin a universe playlist
playlists add-link | = | Add a course link to a course
playlists add-doc | = | Add a course document to a course
playlists item-edit | = | Change a course link or document
playlists item-remove | = | Remove a course link or document
playlists check | = | Check a post of a course for yourself
playlists check-item | = | Check a course link or document
playlists reset-progress | = | Clear your checkmarks in a playlist
playlists checkmarks | = | Show or hide the checkmarks of a playlist
playlists tags | = | Set the playlist tags of an item
playlists track | = | Pick your playlist track
playlists tracks | = | Set the tracks of a playlist
videos list | = | The long videos of an address or a tab
videos chapters propose | = | The chapters proposed for your video
videos chapters set | = | Set the chapters of your video
videos playback | = | Record where you are in a long video
videos quota | = | The video quota of the account
videos history | = | The long videos you watched
videos history remove | = | Remove a video from the history
videos history clear | = | Clear the video history
settings video-history-pause | videos history pause | Pause or resume the video history
posts alt | = | Write the alternative text of an image
posts suggested-alt | = | The suggested alternative text of an image
posts subtitles on | = | Turn the automatic subtitles on
posts subtitles off | = | Turn the automatic subtitles off
posts subtitles correct | = | Correct the subtitles of your clip
post | posts create | Publish a post
reply | posts reply | Reply to a post
quote | posts quote | Quote a post
repost | posts repost | Repost a post
like | posts like | Like a post
unlike | posts unlike | Take back a like
dislike | posts dislike | Dislike a post
undislike | posts undislike | Take back a dislike
not-interested | posts not-interested | Not interested in a post, author, tag or universe
follow | accounts follow | Follow an account, a universe or a tag
unfollow | accounts unfollow | Stop following an address
block | accounts block | Block an account
unblock | accounts unblock | Unblock an account
mute | accounts mute | Mute an account
unmute | accounts unmute | Unmute an account
report | moderation report | Report content to the moderation
universes show | = | The page of a universe
universes list | = | Browse the universes
universes sub | = | The sub-universes of a universe
universes members | = | The members of a universe
universes agent-posts | = | Allow or forbid delegated agents to post
universes join | = | Become a resident of a universe
universes leave | = | Stop being a resident
universes ask-to-join | universes private ask-to-join | Ask to join a private universe
universes favorite add | = | Add a favorite universe
universes favorite remove | = | Remove a favorite universe
universes favorite move | = | Move a favorite universe
universes favorite list | = | The favorite universes
universes favorite alerts-on | = | Turn the alerts of a favorite on
universes favorite alerts-off | = | Turn the alerts of a favorite off
universes favorite skip | = | Stop offering the pick of favorites
universes create-private | universes private create | Create a private universe
universes invite | universes private invite | Invite someone to a private universe
universes conditions show | universes private conditions | The conditions of a universe
universes conditions set | universes private conditions set | Set the conditions of a private universe
universes conditions accept | universes private conditions accept | Accept the conditions of a universe
universes join-requests | universes private join-requests | The join requests waiting
universes join-requests accept | universes private join-requests accept | Accept a join request
universes join-requests decline | universes private join-requests decline | Decline a join request
universes join-requests accept-all | universes private join-requests accept-all | Accept every waiting join request
universes join-requests decline-all | universes private join-requests decline-all | Decline every waiting join request
universes invitations | universes private invitations | The invitations you received
universes invitations accept | universes private invitations accept | Accept an invitation and join
universes invitations decline | universes private invitations decline | Decline an invitation
universes admins add | universes private admins add | Name an admin of a private universe
universes admins remove | universes private admins remove | Remove an admin
universes transfer accept | universes private transfer accept | Accept the transfer of a private universe
universes transfer decline | universes private transfer decline | Decline the transfer of a private universe
universes delete | universes private delete | Delete a private universe
universes delete-cancel | universes private delete-cancel | Cancel the deletion of a private universe
universes private set | = | Change the settings of a private universe
universes domains | universes private domains | Own domains waiting for their DNS proof
universes domains check | universes private domains check | Check the DNS proof of an own domain
universes team-tier | universes private team-tier | Choose the free team member tier
universes declare | universes private declare | Declare an association or open-source project
universes expose | universes private expose | Expose a sub-universe of a private universe
universes hide | universes private hide | Hide the exposed parts again
universes reactivate | universes private reactivate | Reactivate an archived universe
universes reputation | universes private reputation | The reputation of a private universe
universes reputation set | universes private reputation set | Turn the reputation on or off
universes search-words | = | Set the search words of a universe
universes identity | = | Set the banner, logo and watermark
universes tiers offer | universes private tiers offer | Offer a subscription tier
universes tiers change | universes private tiers change | Change a subscription tier
universes tiers withdraw | universes private tiers withdraw | Withdraw a subscription tier
universes tiers subscribe | universes private tiers subscribe | Subscribe to a tier of a private universe
universes tiers renewal on | universes private tiers renewal on | Turn a tier renewal on
universes tiers renewal off | universes private tiers renewal off | Turn a tier renewal off
universes residences | = | Your residences in public universes
universes sub-map | = | The sub-universe map of a universe
universes landing | = | The landing page of a universe
universes land | = | Mark a landing in a universe
universes listed | = | Be listed on the members page
universes unlisted | = | Not be listed on the members page
universes territory get | = | The territory of a universe
universes territory set | = | Set the territory of a universe
universes territory remove | = | Remove the territory of a universe
universes territory report | = | Report the territory of a universe
universes pages | = | The pages of a universe
universes page get | universes pages get | Show a page of a universe
universes page publish | universes pages publish | Publish a custom page
universes page check | universes pages check | Check a custom page without publishing
universes page hide | universes pages hide | Hide a page from the main menu
universes page show | universes pages unhide | Show a hidden page in the menu again
universes page move | universes pages move | Move a custom page in the menu
universes page delete | universes pages delete | Delete a custom page
universes pages export | = | Export the pages of a universe
universes pages import | = | Import pages as studio drafts
universes page report | universes pages report | Report a custom page or a block
explore | = | Suggested posts, tags and accounts
explore why | = | Why a post was recommended
explore muted | = | The universes muted from discovery
explore mute | = | Mute a universe from discovery
explore unmute | = | Unmute a universe from discovery
explore reset | = | Reset the recommendations
resolve | explore resolve | Resolve an address
search | explore search | Search posts, accounts, universes and more
clips feed | posts clips | The clip feed
clips platform | posts clips platform | The platform clips, best first
clips popular | posts clips popular | The popular clips of the week
interests show | = | Your interest profile
interests add | = | Add interests to your profile
interests fields | = | Choose your fields
interests forget | = | Forget interests
interests tags | = | The tags you engaged with
interests not-interested | = | What you said you are not interested in
explore area | = | The universes of an area of the map
places search | map places search | Search a place in an area
map boundary | = | The shape of a boundary
map routes | = | The route markers of an area
map channels | = | The placed channels of an area
map posts | = | The placed posts of an area
map places | = | The places with a recent placed post
map place-feats | = | The places with a place feat of an area
map place-card | = | The card of a place and what is also there
map presences | = | The map presences of an area
map groups | = | The groups of map presence of an area
presence show | map presence | Your map presence
presence start | map presence start | Start your map presence
presence update | map presence update | Move your map presence
presence audience | map presence audience | Change the audience of your map presence
presence ghost on | map presence ghost on | Turn the ghost mode on
presence ghost off | map presence ghost off | Turn the ghost mode off
presence stop | map presence stop | Stop your map presence
live-share list | map live-share list | Your live shares in progress
live-share in | map live-share in | The live shares of a conversation
live-share start | map live-share start | Start a live share of your position
live-share stop | map live-share stop | Stop a live share
live-share positions | map live-share positions | The last positions of live shares
live-share send | map live-share send | Send your latest positions
locatable show | map locatable | Where you are locatable now
locatable residents | map locatable residents | The locatable residents of an area
locatable on | map locatable on | Be locatable in a universe
locatable off | map locatable off | Stop being locatable
locatable move | map locatable move | Move your locatable map cell
meetups answer | messages meetups answer | Answer a meet-up
meetups change | messages meetups change | Change a meet-up
meetups cancel | messages meetups cancel | Cancel a meet-up
nearby token | map nearby token | Your nearby token to advertise
nearby request | map nearby request | Ask to connect with someone nearby
nearby requests | map nearby requests | The Nearby requests
nearby accept | map nearby accept | Accept a Nearby request
nearby decline | map nearby decline | Decline a Nearby request
nearby leave | map nearby leave | Stop Nearby
nearby sightings | map nearby sightings | Send the nearby tokens seen around
posts place | = | Place your post on the map
routes list | = | Your routes
routes show | = | Show a route
routes create | = | Save a new route
routes edit | = | Change a route
routes delete | = | Delete a route
routes copy | = | Copy a route into your routes
routes gpx export | = | Export a route to GPX
routes gpx import | = | Import a GPX file as a route
routes privacy-zones | = | Your privacy zones
routes privacy-zones set | = | Set your privacy zones
routes plan | = | Plan a route through points
time-column | universes time-column | The time column of a universe
live | universes live | The live line of a universe
accounts show | = | The profile of an account
accounts followers | = | The followers of an account
accounts following | = | What an account follows
posts thread | = | A post and its replies
posts reposts | = | The reposts of a post
posts link-preview | = | The preview of a link
posts reply-policy | = | Set who can reply to your post
accounts replies | = | The replies of an account
accounts is-following | = | Whether you follow an address
map avatar | = | Your map avatar
notifications | me notifications | Your notifications
events list | = | The events of a universe
events create | = | Propose an event in a universe
events attend | = | Attend an event
proposals list | = | The proposals of a universe
proposals show | = | Show a proposal
proposals file | = | File a proposal
proposals support | = | Support a proposal
proposals vote | = | Vote on a proposal
proposals withdraw | = | Withdraw your proposal
debates list | discussions debates list | The debates of a universe
debates show | discussions debates show | Show a debate
debates open | discussions debates open | Open a debate
debates propose | discussions debates propose | Propose a debate
debates support | discussions debates support | Support a proposed debate
debates close | discussions debates close | Close a debate early
polls list | = | The polls of a universe
polls show | = | Show a poll
polls create | = | Create a poll
polls pick | = | Pick a choice of a poll
proposals votes | = | The votes of the representatives
proposals mine | = | Your proposals
proposals projects | = | The projects of a universe
proposals project-status | = | Set the status of a project
proposals project-done | = | Declare a project done
proposals refusal-review | = | Ask a review of a refused proposal
proposals change | = | Amend a proposal (always refused)
polls support | = | Support a poll waiting for support
events support | = | Support a proposed event
events change | = | Change an event
events delete | = | Delete an event
events attendees | = | The attendees of an event
sanctions list | me sanctions | Your sanctions in universes
sanctions appeal | me sanctions appeal | Appeal a sanction to a jury
sanctions publish-name | me sanctions publish-name | Publish your name with your appeal
jury accept | = | Accept your draw as a juror
jury decline | = | Decline your draw as a juror
jury reviews | = | Ask the AI reviews of a sanction
jury vote | = | Vote as a juror
jury withdraw | = | Withdraw from a jury
channels list | discussions channels | The channels of a universe
channels create | discussions channels create | Open a channel
channels join | discussions channels join | Join a channel
channels leave | discussions channels leave | Leave a channel
channels send | discussions send | Send a message in a discussion
channels read | discussions read | Read the messages of a discussion
channels levels | discussions channels levels | Where a channel proposal may open
inbox | messages inbox | Your conversations and group chats
dm | messages direct send | Send a direct message
dm read | messages direct read | Read a conversation
dm delete | messages direct delete | Delete a direct message
dm ephemeral | messages direct ephemeral | Make a conversation disappear
groups create | messages groups create | Create a group chat
groups list | messages groups | Your group chats
groups show | messages groups show | Show a group chat
groups send | messages groups send | Send a message in a group chat
groups read | messages groups read | Read a group chat
groups invite | messages groups invite | Invite someone to a group chat
groups leave | messages groups leave | Leave a group chat
groups members | messages groups members | The members of a group chat
groups admins | messages groups admins | The admins of a group chat
groups admin-add | messages groups admin-add | Name an admin of a group chat
groups admin-remove | messages groups admin-remove | Remove an admin of a group chat
groups ephemeral | messages groups ephemeral | Make group messages disappear
groups invitations | messages groups invitations | Your group chat invitations
groups accept | messages groups accept | Accept a group chat invitation
groups decline | messages groups decline | Decline a group chat invitation
connections request | = | Send a connection request
connections accept | = | Accept a connection request
connections decline | = | Decline a connection request
connections remove | = | End a connection
connections list | = | The accounts connected
connections requests | = | The connection requests
connections state | = | Whether you can connect with an account
messaging settings show | messages settings | The settings of the messages
messaging settings set | messages settings set | Change the settings of the messages
connections mine | = | Your connections, in a stable order
dm delete-conversation | messages direct delete-conversation | Delete a conversation for yourself
groups edit | messages groups edit | Change a group chat
groups remove | messages groups remove | Remove a member from a group chat
groups meeting-point | messages groups meeting-point | Set the meeting point of a group chat
groups step-down | messages groups step-down | Stop being an admin of a group chat
groups mute | messages groups mute | Mute a group chat
groups unmute | messages groups unmute | Unmute a group chat
messages edit | = | Edit one of your messages
messages typing | = | Say you are typing
messages changes | = | Messages changed since a time
messages pinned | = | The pinned messages of a discussion
messages pin | = | Pin a message for everyone
messages unpin | = | Unpin a message
messages silence | = | Silence a discussion for yourself
messages unsilence | = | End the silence of a discussion
messages quick-poll | = | Send a quick poll
messages quick-poll-pick | = | Pick a choice of a quick poll
discussions list | = | The discussions of a universe
discussions show | = | Show a universe discussion
discussions unread | = | Discussions with unread messages
discussions pin | = | Pin a discussion for yourself
discussions unpin | = | Unpin a discussion for yourself
discussions place set | = | Set the place of a public channel
discussions place remove | = | Remove the place of a public channel
discussions mine | = | The discussions you joined
discussions limits | = | The limits of the discussions of a universe
discussions moderators | = | The moderators of a discussion
discussions moderators add | = | Name a moderator of a discussion
discussions moderators remove | = | Remove a moderator of a discussion
discussions writing-bans | = | The writing bans of a discussion
discussions active | = | Who wrote in a discussion lately
discussions extend | = | Extend a debate opened by the governance
discussions summary approve | = | Approve the summary of a debate
discussions summary decline | = | Decline the summary of a debate
discussions cap | = | Raise the cap of open debates
discussions creation members | = | Let members create discussions
discussions creation managers | = | Only managers create discussions
discussions archive | = | Archive a discussion
discussions unarchive | = | Take a discussion out of the archive
discussions move | = | Move a discussion in the list
discussions slow-mode | = | Set the slow mode of a discussion
discussions ban | = | Ban an account from writing
discussions unban | = | Lift a writing ban
discussions remove-message | = | Remove a message as a moderator
discussions delete | = | Delete an archived channel
discussions agents forbid | = | Forbid delegated agents in a channel
discussions agents allow | = | Allow delegated agents in a channel
discussions mute | = | Mute a discussion for yourself
discussions unmute | = | Unmute a discussion
events relay | = | Relay an event in another universe
events relay support | = | Support a proposed relay
events relay remove | = | Remove a relay of an event
events relays proposals | = | The relay proposals waiting
events catalog | = | The event families and types
settings presence | discussions presence-choice set | Choose who sees you by name
settings presence show | discussions presence-choice | Who sees you by name
discussions present | = | The present residents you may see
messages universes | = | The Universes section of Messages
messages mentions | = | The Mentions row of Messages
messages ignore-mention | = | Ignore a discussion of the Mentions row
messages remove-discussion | = | Remove a discussion from Messages
messages block-universe | = | Block a universe in Messages
messages unblock-universe | = | Lift the block of a universe in Messages
messages vote | = | Give your contribution vote to a message
messages unvote | = | Withdraw your contribution vote
messages react | = | React to a message
messages unreact | = | Remove your reaction
messages thread | = | The thread replies of a message
messages reply-thread | = | Reply in the thread of a message
messages delete | = | Delete a message for everyone
themes list | look themes list | The theme catalog
themes show | look themes show | The page of a theme
themes gallery | look themes gallery | The themes offered in a universe, not applied
universes appearance-history | look appearance history | The appearance history of a universe
universes appearance-restore | look appearance restore | Restore an appearance of the history
appearance show | look appearance show | The appearance applied to a universe
appearance looks | look appearance looks | The looks of quick start
appearance palette | look appearance palette | The candidate colors of an image
appearance build | look appearance build | Build an appearance from gestures
appearance apply | look appearance apply | Apply or propose an appearance
universes tags conventions | = | Set the tag conventions of a universe
universes tags suggestions | = | The suggested tags of a universe
universes tags view | = | The view of a universe and a tag
universes history | = | Your universe visit history
universes history remove | = | Remove a universe from the history
universes history clear | = | Clear the visit history
universes visit | universes history visit | Record a visit of a universe
settings history-pause | universes history pause | Pause or resume the visit history
theme prompt | look themes prompt | Write the prompt that asks an AI for a theme
theme check | look themes check | Check a theme as the platform does
theme pack | look themes pack | Pack a theme and its images in a ZIP
theme unpack | look themes unpack | Unpack the ZIP of a theme
theme typefaces | look themes typefaces | List the approved typefaces
theme publish | look themes publish | Publish a theme in a universe
theme apply | look themes apply | Make a theme the theme of a universe
theme personal set | look personal set | Set your personal theme
theme personal clear | look personal clear | Back to the default personal theme
theme personal saved | look personal saved | Your saved personal themes
theme export | look themes export | Export a theme
theme shots | look themes shots | Download the screenshots of a theme
theme delete | look themes delete | Delete a theme you published
layouts list | look layouts list | The layout catalog
layouts show | look layouts show | Show a layout
layouts check | look layouts check | Check a layout document
layouts publish | look layouts publish | Publish a layout in a universe
layouts publish-version | look layouts publish-version | Publish a new version of a layout
layouts apply | look layouts apply | Make a layout the default of a universe
layouts copy | look layouts copy | Copy a layout under a new name
layouts delete | look layouts delete | Delete a layout you published
studio drafts | look studio drafts | The drafts of the studio
studio show | look studio show | Show a draft of the studio
studio save | look studio save | Save a draft in the studio
studio delete | look studio delete | Delete a draft of the studio
studio use | look studio use | Use a draft of the studio
studio make-theme | look studio make-theme | Publish a theme draft and apply it
studio try | look studio try | Try a theme draft on its universe
studio end-try | look studio end-try | End the theme trial of a universe
studio preview | look studio preview | Preview a theme draft for yourself
studio end-preview | look studio end-preview | End your draft preview
studio make-layout | look studio make-layout | Publish a layout draft and apply it
studio make-page | look studio make-page | Publish a page draft
ads campaigns | = | Your ad campaigns
ads show | = | Show an ad campaign
ads create | = | Create an ad campaign
ads update | = | Change an ad campaign
ads submit | = | Send an ad campaign to review
ads pause | = | Pause an ad campaign
ads resume | = | Resume an ad campaign
ads end | = | End an ad campaign
ads pay | = | Prepay the budget of a campaign
ads suggest | = | Universes suggested for an offer
ads group | = | The universe group of a universe
ads repository | = | The public ad repository
ads why | = | Why an ad was shown
ads interests | = | Your declared ad interests
ads interests set | = | Set your declared ad interests
batch | = | Run the actions of a JSON lines file
moderation awaiting | = | The posts awaiting approval
moderation approve | = | Approve a post awaiting approval
moderation remove | = | Remove a post as a moderator
moderation dismiss-reports | = | Dismiss the reports of a post
moderation hide-reply | = | Hide a reply
moderation unhide-reply | = | Show a hidden reply again
moderation posting-ban | = | Give a posting ban
moderation ban | = | Ban an account from a universe
moderation lift-ban | = | Lift a ban
moderation bans | = | The bans of a universe
moderation reports | = | The reports of the posts of a universe
moderation appearance-reports | = | The reports of themes and banners
moderation log | = | The moderation log
moderation moderators | = | The moderators of a universe
moderation appoint | = | Appoint a moderator
moderation appeals | = | The appeals of a universe
moderation decide-appeal | = | Decide an appeal
governance show | = | Who governs a universe
governance history | = | The governance history, as posts
governance ask | = | Ask the leadership a question
governance questions | = | The questions to the leadership
governance answer | = | Answer a question
governance manifesto | = | The manifesto of a universe
governance manifesto-set | = | Set the manifesto
governance successors | = | Name the successors of the owner
governance transfer | = | Transfer a universe to an account
governance field | = | Set the field of a universe
governance display | = | Set the display name of a universe
governance territory | = | Set the territory (governance form)
governance my-vote | = | Your votes in a universe
governance lend-votes | = | Lend your votes to an account
governance withdraw-votes | = | Take back the votes you lent
governance proposals | = | The proposals by status and kind
governance record | = | The governance record
governance duties | = | Your jury duties
governance layout | = | The layout of the governance page
governance pinned | = | The pinned channels of a private universe
governance pin | = | Pin the channels of a private universe
governance residents | = | The residents of a public universe
governance welcome-wall | = | The new residents of the week
governance welcome | = | Welcome a new resident
governance news | = | The news of a universe
governance pulse | = | The pulse of a public universe
governance manifesto-versions | = | The versions of the manifesto
governance sub-governance | = | Give a sub-universe its own governance
governance move-pinned | = | Move a pinned post
governance unpin-announcement | = | Unpin an announcement
governance backup-delegate | = | Choose a backup delegate
governance votes-accept | = | Accept the votes lent to you
governance votes-refuse | = | Refuse the votes lent to you
governance vote-holders | = | The top holders of lent votes
governance feed-reviews | = | The feed removal reviews
governance feed-review-vote | = | Vote on a feed removal review
governance like-question | = | Like a question to the leadership
governance unlike-question | = | Take back the like of a question
moderation remove-agent-text | = | Remove an off-charter platform AI text
mcp | = | Start the MCP server on stdio
`;

export type Placement = { path: string; summary: string };

/** Former name → its place in the tree. */
export const PLACEMENTS: ReadonlyMap<string, Placement> = new Map(TABLE.trim().split('\n').map((line) => {
  const [name, path, summary] = line.split(' | ').map((s) => s.trim());
  return [name, { path: path === '=' ? name : path, summary }];
}));

/**
 * The default action of a group: "breakrocks look appearance %lyon" runs "look appearance show %lyon" (a word after the
 * group that is neither a command nor a subgroup of it, nor an option).
 */
export const DEFAULT_ACTIONS: Record<string, string> = { 'look appearance': 'show' };

/** The domains of the overview (breakrocks help <domain>): their groups, as the top-level help shows them. */
export const DOMAINS: { name: string; groups: string[]; line: string }[] = [
  { name: 'account', groups: ['login', 'logout', 'whoami', 'me'], line: 'login, logout, whoami, me' },
  { name: 'agents', groups: ['operator', 'agents', 'wallet'], line: 'operator, agents, wallet' },
  { name: 'universes', groups: ['universes'], line: 'universes (favorite, private, pages, territory)' },
  { name: 'content', groups: ['posts', 'videos', 'drafts', 'polls', 'playlists'], line: 'posts, videos, drafts, polls, playlists' },
  { name: 'talk', groups: ['messages', 'discussions'], line: 'messages (direct, groups), discussions (channels, debates)' },
  { name: 'map', groups: ['map', 'routes'], line: 'map (presence, live-share, nearby, locatable), routes' },
  { name: 'events', groups: ['events'], line: 'events' },
  { name: 'governance', groups: ['governance', 'proposals', 'jury', 'moderation'], line: 'governance, proposals, jury, moderation' },
  { name: 'look', groups: ['look'], line: 'look (themes, personal, appearance, layouts, studio)' },
  { name: 'explore', groups: ['explore', 'accounts', 'connections', 'interests'], line: 'explore, accounts, connections, interests' },
  { name: 'money', groups: ['subscription', 'ads', 'gift-codes'], line: 'subscription, ads, gift-codes' },
  { name: 'tools', groups: ['doctor', 'usage', 'schema', 'batch', 'mcp', 'completion', 'update', 'config', 'help', 'version'], line: 'doctor, usage, schema, batch, mcp, completion, update, config' },
];

/** The summary of a group or a subgroup in the lists (breakrocks help <group>, the completion). */
export const GROUP_SUMMARIES: Record<string, string> = {
  login: 'Sign in', logout: 'Sign out', whoami: 'The account signed in', me: 'The account itself, its settings and history',
  'me data': 'Data requests: copy, erasure, rectification', 'me email': 'Change the email address', 'me handle': 'Check or change the handle',
  'me onboarding': 'The onboarding', 'me invitation-link': 'The personal invitation link', 'me invite-exceptions': 'Who may invite you anyway',
  'me measures': 'Platform measures and their appeal', 'me terms': 'The terms of use', 'me sanctions': 'Your sanctions and their appeal', 'me profile': 'The account profile',
  'me delete': 'Delete the account',
  operator: 'Agent operators: keys, registration, plans', 'operator plan': 'The agent plan paid by card', 'operator recovery-key': 'The recovery key',
  agents: 'Delegated agents and local agents', wallet: 'The x402 wallet',
  universes: 'Universes: pages, residence, favorites, private ones', 'universes favorite': 'Favorite universes',
  'universes private': 'Private universes: create, invite, conditions, requests', 'universes private conditions': 'The conditions of a universe',
  'universes private join-requests': 'Join requests', 'universes private invitations': 'Invitations received', 'universes private admins': 'Admins',
  'universes private transfer': 'Transfers of a private universe', 'universes private domains': 'Own domains', 'universes private reputation': 'Reputation',
  'universes private tiers': 'Subscription tiers', 'universes private tiers renewal': 'Tier renewal',
  'universes pages': 'The pages of a universe', 'universes territory': 'The territory of a universe', 'universes history': 'The visit history',
  'universes tags': 'Tags of a universe',
  posts: 'Posts: publish, react, read, edit', 'posts subtitles': 'Subtitles of a clip', 'posts clips': 'The clip feeds', 'posts repost-requests': 'Repost requests of private universes',
  videos: 'Long videos', 'videos chapters': 'Chapters of a video', 'videos history': 'The video history',
  drafts: 'Post drafts and scheduled posts', polls: 'Polls', playlists: 'Playlists, series and courses',
  messages: 'Messages: direct, groups, inbox, reactions', 'messages direct': 'Direct messages', 'messages groups': 'Group chats', 'messages meetups': 'Meet-ups',
  'messages settings': 'The settings of the messages',
  discussions: 'Universe discussions: channels, debates, moderation', 'discussions channels': 'Channels (permanent discussions)', 'discussions debates': 'Debates (temporary discussions)',
  'discussions place': 'The place of a public channel', 'discussions moderators': 'Moderators of a discussion', 'discussions summary': 'The summary of a debate',
  'discussions creation': 'Who creates discussions', 'discussions agents': 'Delegated agents in a channel', 'discussions presence-choice': 'Who sees you by name',
  map: 'The map: areas, presence, live shares, Nearby', 'map presence': 'Your map presence', 'map presence ghost': 'The ghost mode', 'map live-share': 'Live shares of your position',
  'map nearby': 'Nearby connections', 'map locatable': 'Being locatable', 'map places': 'Places of the map',
  routes: 'Routes: saved, GPX, privacy zones, planning', 'routes gpx': 'GPX files', 'routes privacy-zones': 'Privacy zones',
  events: 'Universe events and relays', 'events relay': 'Relays of events', 'events relays': 'Relay proposals',
  governance: 'Governance of a universe', proposals: 'Proposals and votes', jury: 'Juries of sanction appeals', moderation: 'Moderation and reports',
  look: 'Themes, appearance, layouts and the studio', 'look themes': 'Themes: catalog, offline tools, publish', 'look personal': 'Your personal theme',
  'look appearance': 'The appearance of a universe: what is applied, the editor', 'look layouts': 'Layouts', 'look studio': 'The drafts of the studio',
  explore: 'Discovery, search and recommendations', accounts: 'Accounts: read, follow, block, mute', connections: 'Connections between accounts', interests: 'Your interest profile',
  subscription: 'The paid tiers of the account', 'subscription renewal': 'The automatic renewal', 'subscription billing-day': 'The billing day',
  ads: 'Advertising', 'ads interests': 'Your ad interests', 'gift-codes': 'Gift codes of the paid tiers',
  doctor: 'Check the CLI', usage: 'Usage and limits', schema: 'JSON Schemas of the commands', batch: 'Actions of a file', mcp: 'The MCP server',
  completion: 'Shell completion', update: 'Update the CLI', config: 'CLI profiles and settings', help: 'This help', version: 'The version',
};
