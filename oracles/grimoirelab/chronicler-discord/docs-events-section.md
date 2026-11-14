### Discord

Discord events are related to messages sent to Discord channels and threads.
They are produced from the items fetched by the Perceval `discord` backend.

#### Message

- Event type: `org.grimoirelab.events.discord.message`

The data of the event is the [message object](https://discord.com/developers/docs/resources/message#message-object)
returned by the Discord API v10, plus the channel it was sent to. These are some of its fields:

| Field              | Type                      | Description                                                    |
|--------------------|---------------------------|----------------------------------------------------------------|
| id                 | `String`                  | Message identifier (snowflake)                                 |
| type               | `Integer`                 | Discord message type                                           |
| content            | `String`                  | Text of the message                                            |
| author             | `Object`                  | Discord user who sent the message; `bot` is `true` for bots    |
| mentions           | `List (Object)`           | Discord users mentioned in the message                         |
| timestamp          | `String`                  | Date when the message was sent                                 |
| edited_timestamp   | `String`                  | Date when the message was last edited, if it was edited        |
| message_reference  | `Object`                  | Message replied to, forwarded or announced by this message     |
| reactions          | `List (Object)`           | Number of reactions of each emoji                              |
| thread             | `Object`                  | Thread started from this message                               |
| channel_data       | `Object`                  | Channel or thread where the message was sent                   |

#### Message edited

The last edition of a message. The time of the event is the time of the edition.

- Event type: `org.grimoirelab.events.discord.message.edited`

| Field            | Type     | Description                       |
|------------------|----------|-----------------------------------|
| message          | `String` | Message identifier                |
| channel_id       | `String` | Channel identifier                |
| edited_timestamp | `String` | Date when the message was edited  |

#### Reply

A message that replies to another one. Other messages that reference a
message, such as pin notifications or forwarded messages, are not replies.

- Event type: `org.grimoirelab.events.discord.message.reply`

| Field              | Type     | Description                                    |
|--------------------|----------|------------------------------------------------|
| message            | `String` | Message identifier                             |
| channel_id         | `String` | Channel identifier                             |
| replied_message    | `String` | Identifier of the message replied to           |
| replied_channel_id | `String` | Channel identifier of the message replied to   |
| replied_guild_id   | `String` | Guild identifier of the message replied to     |

#### Reaction

The number of reactions of an emoji on a message. Discord does not tell
who reacted nor when, so the time of the event is when Perceval fetched
the message.

- Event type: `org.grimoirelab.events.discord.message.reaction`

| Field      | Type      | Description                                      |
|------------|-----------|--------------------------------------------------|
| message    | `String`  | Message identifier                               |
| channel_id | `String`  | Channel identifier                               |
| emoji_id   | `String`  | Identifier of a custom emoji; `null` for Unicode |
| emoji_name | `String`  | Name of the emoji, or the Unicode emoji itself   |
| count      | `Integer` | Number of reactions with this emoji              |

#### Thread created

A thread started from a message, or announced by a `THREAD_CREATED` message.

- Event type: `org.grimoirelab.events.discord.thread.created`

| Field            | Type     | Description                                 |
|------------------|----------|---------------------------------------------|
| message          | `String` | Identifier of the message                   |
| thread_id        | `String` | Thread identifier                           |
| name             | `String` | Name of the thread                          |
| parent_id        | `String` | Identifier of the channel of the thread     |
| owner_id         | `String` | Identifier of the user who created it       |
| create_timestamp | `String` | Date when the thread was created            |

#### Message contributors

Information about Discord users related to a message.

| Field    | Type      | Description                                            |
|----------|-----------|--------------------------------------------------------|
| message  | `String`  | Message identifier                                     |
| name     | `String`  | Display name of the user (`global_name`)               |
| username | `String`  | Username of the user                                   |
| email    | `String`  | Always `null`; Discord does not give it                |
| uuid     | `String`  | Unique identifier of the contributor                   |
| role     | `String`  | Role of the contributor                                |
| source   | `String`  | Source of the identity. Always `discord` for messages. |
| user_id  | `String`  | Discord user identifier                                |
| bot      | `Boolean` | Whether the user is a bot                              |

##### Author

Identifies the user who sent the message.

- Event type: `org.grimoirelab.events.discord.message.authored_by`

##### Mentioned

Identifies a user mentioned in the message.

- Event type: `org.grimoirelab.events.discord.message.mentioned`
