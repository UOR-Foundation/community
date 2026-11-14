<!-- Draft for chaoss/wg-dei, in its "Revising a Metric" issue template. Not submitted: it opens only after Alex approves, and after the template pull request in chaoss/community. One issue covers the working group's items; it can be split per metric if the WG prefers. -->

### Name of the Metric Being Revised

* Chat Platform Inclusivity (`focus-areas/project-and-community/chat-platform-inclusivity.md`)

### Link to Original Metric Release Issue

Not specified in the definitions; the working group can add them.

### Specific Metric Details that Require Attention

#### Chat Platform Inclusivity

The definition names GrimoireLab Perceval as the tool providing this metric, but no computation. GrimoireLab's own chat panels compute two of its Filters under the same names, and we propose citing them:

* **Number of messages per day, week, month** → GrimoireLab “Messages”: `count()` over the chat index, as `panels/json/slack.json#slack_main_numbers`, `panels/json/mattermost.json#6f147b00-bd3d-11eb-ac68-4b98ff9064cd`, `panels/json/irc.json#irc_main_metrics`, `panels/json/telegram.json#telegram_main_metrics` compute it.
* **Number of active participants per day, week, month** → GrimoireLab “Participants”: `cardinality(author_uuid)` over the chat index, as `panels/json/slack.json#slack_main_numbers`, `panels/json/mattermost.json#6f147b00-bd3d-11eb-ac68-4b98ff9064cd`, `panels/json/irc.json#irc_main_metrics` compute it.
* **Number of active Chat rooms/groups**: GrimoireLab's panels label the count of distinct channels Channels, not rooms or groups; the working group is asked whether Channels is the quantity.
* **Number of passive participants (i.e. reading but not participating)**: No GrimoireLab backend records who reads a channel.
* **Number of external participants (i.e. people who are not associated with a leading company working on an Open Source Project, such as Red Hat with the Fedora Project)**: It needs organization affiliations (SortingHat enrollments), which no chat backend collects.

- **Entity:** open until the working group names the computations proposed above.
- **Attribute:** open until the working group names the computations proposed above.
- **Scale:** open until the working group names the computations proposed above.
- **Unit:** open until the working group names the computations proposed above.

### Checklist

- [ ] Create the “revising metric” labeled issue in the authoring WG’s repo for comments during review period
- [ ] Create pull request of revised metric to WG’s repo
- [ ] Metric adheres to the current metrics template
