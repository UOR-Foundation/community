#
# Copyright (C) GrimoireLab Developers
#
# This program is free software; you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation; either version 3 of the License, or
# (at your option) any later version.
#
# This program is distributed in the hope that it will be useful,
# but WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
# GNU General Public License for more details.
#
# You should have received a copy of the GNU General Public License
# along with this program. If not, see <http://www.gnu.org/licenses/>.
#

import logging
from collections.abc import Generator
from typing import Any

from cloudevents.http import CloudEvent
from grimoirelab_toolkit.datetime import str_to_datetime
from grimoirelab_toolkit.identities import generate_uuid

from ...eventizer import Eventizer, Identity, uuid

DISCORD_EVENT_MESSAGE = "org.grimoirelab.events.discord.message"
DISCORD_EVENT_MESSAGE_EDITED = "org.grimoirelab.events.discord.message.edited"
DISCORD_EVENT_MESSAGE_REPLY = "org.grimoirelab.events.discord.message.reply"
DISCORD_EVENT_MESSAGE_REACTION = "org.grimoirelab.events.discord.message.reaction"
DISCORD_EVENT_THREAD_CREATED = "org.grimoirelab.events.discord.thread.created"

DISCORD_EVENT_MESSAGE_AUTHORED_BY = "org.grimoirelab.events.discord.message.authored_by"
DISCORD_EVENT_MESSAGE_MENTIONED = "org.grimoirelab.events.discord.message.mentioned"

# Message and message reference types from the Discord API v10.
# A reply is a REPLY message whose reference is of type DEFAULT;
# other messages, such as pin notifications or forwarded messages,
# also carry a reference but they are not replies.
DISCORD_MESSAGE_TYPE_THREAD_CREATED = 18
DISCORD_MESSAGE_TYPE_REPLY = 19
DISCORD_MESSAGE_REFERENCE_TYPE_DEFAULT = 0

logger = logging.getLogger(__name__)


class DiscordEventizer(Eventizer):
    """Eventize Discord messages"""

    def eventize_item(self, raw_item: dict[str, Any]) -> list[CloudEvent]:
        events = []

        item_uuid = raw_item.get("uuid", None)

        if not item_uuid:
            raise ValueError("'uuid' attribute not found on item.")
        if raw_item["backend_name"].lower() != "discord":
            raise ValueError(f"Item {item_uuid} is not a 'discord' item.")
        if raw_item["category"] != "message":
            raise ValueError(f"Invalid category '{raw_item['category']}' for '{item_uuid}' item.")

        attributes = {
            "id": item_uuid,
            "type": DISCORD_EVENT_MESSAGE,
            "source": raw_item["origin"],
            "time": raw_item["updated_on"],
        }

        event = CloudEvent(attributes, raw_item["data"])
        events.append(event)

        message = raw_item["data"]

        edited_event = self._eventize_message_edited(event, message)
        if edited_event:
            events.append(edited_event)

        reply_event = self._eventize_message_reply(event, message)
        if reply_event:
            events.append(reply_event)

        thread_event = self._eventize_thread_created(event, message)
        if thread_event:
            events.append(thread_event)

        reaction_events = self._eventize_message_reactions(
            event, message, raw_item.get("timestamp", raw_item["updated_on"])
        )
        events.extend(reaction_events)

        identities_events = self._eventize_message_identities(event, message)
        events.extend(identities_events)

        return events

    def _eventize_message_edited(
        self,
        parent_event: CloudEvent,
        message: dict[str, Any],
    ) -> CloudEvent | None:
        """Eventize the last edition of a message, if it was edited.

        The time of the event is the moment of the last edition.
        """
        edited_on = message.get("edited_timestamp", None)
        if not edited_on:
            return None

        data = {
            "message": message["id"],
            "channel_id": message["channel_id"],
            "edited_timestamp": edited_on,
        }

        attributes = {
            "id": uuid(parent_event["id"], "edited", edited_on),
            "linked_event": parent_event["id"],
            "type": DISCORD_EVENT_MESSAGE_EDITED,
            "source": parent_event["source"],
            "time": str_to_datetime(edited_on).timestamp(),
        }

        return CloudEvent(attributes, data)

    def _eventize_message_reply(
        self,
        parent_event: CloudEvent,
        message: dict[str, Any],
    ) -> CloudEvent | None:
        """Eventize a reply to another message."""

        reference = message.get("message_reference", None)
        if not reference or message.get("type") != DISCORD_MESSAGE_TYPE_REPLY:
            return None
        if reference.get("type", DISCORD_MESSAGE_REFERENCE_TYPE_DEFAULT) != (
            DISCORD_MESSAGE_REFERENCE_TYPE_DEFAULT
        ):
            return None

        replied_message = reference.get("message_id", None)
        if not replied_message:
            return None

        data = {
            "message": message["id"],
            "channel_id": message["channel_id"],
            "replied_message": replied_message,
            "replied_channel_id": reference.get("channel_id", None),
            "replied_guild_id": reference.get("guild_id", None),
        }

        attributes = {
            "id": uuid(parent_event["id"], "reply", replied_message),
            "linked_event": parent_event["id"],
            "type": DISCORD_EVENT_MESSAGE_REPLY,
            "source": parent_event["source"],
            "time": parent_event["time"],
        }

        return CloudEvent(attributes, data)

    def _eventize_thread_created(
        self,
        parent_event: CloudEvent,
        message: dict[str, Any],
    ) -> CloudEvent | None:
        """Eventize the creation of a thread.

        A thread started from a message is included in the `thread`
        field of that message. A thread started without a message
        is announced by a THREAD_CREATED message that references it.
        """
        thread = message.get("thread", None)
        if thread:
            thread_id = thread["id"]
            name = thread.get("name", None)
            parent_id = thread.get("parent_id", None)
            owner_id = thread.get("owner_id", None)
            metadata = thread.get("thread_metadata", None) or {}
            created_on = metadata.get("create_timestamp", None)
        elif message.get("type") == DISCORD_MESSAGE_TYPE_THREAD_CREATED:
            reference = message.get("message_reference", None) or {}
            thread_id = reference.get("channel_id", None)
            if not thread_id:
                return None
            name = message.get("content", None)
            parent_id = message["channel_id"]
            owner_id = message["author"]["id"]
            created_on = message["timestamp"]
        else:
            return None

        data = {
            "message": message["id"],
            "thread_id": thread_id,
            "name": name,
            "parent_id": parent_id,
            "owner_id": owner_id,
            "create_timestamp": created_on,
        }

        attributes = {
            "id": uuid(parent_event["id"], "thread_created", thread_id),
            "linked_event": parent_event["id"],
            "type": DISCORD_EVENT_THREAD_CREATED,
            "source": parent_event["source"],
            "time": str_to_datetime(created_on).timestamp() if created_on else parent_event["time"],
        }

        return CloudEvent(attributes, data)

    def _eventize_message_reactions(
        self,
        parent_event: CloudEvent,
        message: dict[str, Any],
        observed_on: float,
    ) -> list[CloudEvent]:
        """Eventize the reactions of a message.

        Discord gives the number of reactions of each emoji but not who
        reacted nor when, so each event carries the count observed when
        the item was fetched, and the time of the event is that moment.
        """
        events = []

        for reaction in message.get("reactions", None) or []:
            emoji = reaction["emoji"]
            emoji_key = emoji.get("id", None) or emoji.get("name", None)
            if not emoji_key:
                logger.warning(f"Reaction without emoji in event '{parent_event['id']}'. Skipping.")
                continue

            data = {
                "message": message["id"],
                "channel_id": message["channel_id"],
                "emoji_id": emoji.get("id", None),
                "emoji_name": emoji.get("name", None),
                "count": reaction["count"],
            }

            attributes = {
                "id": uuid(parent_event["id"], "reaction", emoji_key),
                "linked_event": parent_event["id"],
                "type": DISCORD_EVENT_MESSAGE_REACTION,
                "source": parent_event["source"],
                "time": observed_on,
            }

            events.append(CloudEvent(attributes, data))

        return events

    def _eventize_message_identities(
        self,
        parent_event: CloudEvent,
        message: dict[str, Any],
    ) -> list[CloudEvent]:
        """Eventize the author and the mentioned users of a message."""

        events = []

        identity_events = self._process_identities(
            parent_event["source"],
            parent_event["time"],
            parent_event["id"],
            DISCORD_EVENT_MESSAGE_AUTHORED_BY,
            message["id"],
            [message["author"]],
        )
        events.extend(identity_events)

        identity_events = self._process_identities(
            parent_event["source"],
            parent_event["time"],
            parent_event["id"],
            DISCORD_EVENT_MESSAGE_MENTIONED,
            message["id"],
            message.get("mentions", None) or [],
        )
        events.extend(identity_events)

        return events

    def _process_identities(
        self,
        source: str,
        time: float,
        event_uuid: str,
        event_type: str,
        message_id: str,
        raw_users: list[dict[str, Any]],
    ) -> Generator[CloudEvent, None, None]:
        """Obtain identity events from a list of Discord users.

        :param source: data source of the event
        :param time: time of the event
        :param event_uuid: UUID of the parent event
        :param event_type: type of the identity event
        :param message_id: identifier of the message where users took part
        :param raw_users: list of Discord user objects

        :returns: generator of CloudEvent with the identity information
        """
        for raw_user in raw_users:
            try:
                identity = self._parse_identity(raw_user)
                identity_id = generate_uuid(
                    source="discord",
                    email=identity.email,
                    name=identity.name,
                    username=identity.username,
                )
            except ValueError as e:
                logger.warning(
                    f"Cannot generate UUID for identity '{raw_user.get('id', None)}' "
                    f"in event '{event_uuid}': {e}. Skipping."
                )
                continue

            role = event_type.split(".")[-1]
            event_id = uuid(event_uuid, role, identity_id)

            data = {
                "message": message_id,
                "source": "discord",
                "name": identity.name,
                "username": identity.username,
                "email": identity.email,
                "role": role,
                "uuid": identity_id,
                "user_id": raw_user.get("id", None),
                "bot": raw_user.get("bot", False),
            }

            attributes = {
                "id": event_id,
                "linked_event": event_uuid,
                "type": event_type,
                "source": source,
                "time": time,
            }

            yield CloudEvent(attributes, data)

    @staticmethod
    def _parse_identity(user: dict[str, Any]) -> Identity:
        """Extract identity information from a Discord user object.

        The display name is `global_name`; users without one are
        known only by their unique `username`.
        """
        name = user.get("global_name", None) or None
        username = user.get("username", None) or None

        return Identity(name=name, username=username)
