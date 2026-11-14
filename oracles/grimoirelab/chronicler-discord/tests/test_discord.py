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

import copy
import json
import unittest

from chronicler.eventizer import eventize
from chronicler.events.core.discord import (
    DISCORD_EVENT_MESSAGE,
    DISCORD_EVENT_MESSAGE_AUTHORED_BY,
    DISCORD_EVENT_MESSAGE_EDITED,
    DISCORD_EVENT_MESSAGE_MENTIONED,
    DISCORD_EVENT_MESSAGE_REACTION,
    DISCORD_EVENT_MESSAGE_REPLY,
    DISCORD_EVENT_THREAD_CREATED,
    DiscordEventizer,
)

DISCORD_ORIGIN = "https://discord.com/channels/1301234567890123456/1301234567890123457"


def read_items():
    """Read the items the Perceval Discord backend produced from its fixtures"""

    with open("data/discord_messages.txt", encoding="utf-8") as file:
        return [json.loads(line.strip()) for line in file]


class DiscordEventizerTestCase(unittest.TestCase):
    """Unit tests for DiscordEventizer class"""

    def setUp(self):
        self.items = read_items()

    def test_eventize_item_message(self):
        """Check if it produces the right events from a message"""

        eventizer = DiscordEventizer()

        events = eventizer.eventize_item(self.items[0])

        self.assertEqual(len(events), 2)

        message_event = events[0]
        self.assertEqual(message_event["id"], "25c235fe1d7f783a45c5d51b6f1d7eddf55f22fa")
        self.assertEqual(message_event["type"], DISCORD_EVENT_MESSAGE)
        self.assertEqual(message_event["source"], DISCORD_ORIGIN)
        self.assertEqual(message_event["time"], 1793527200.0)
        self.assertEqual(message_event.data["content"], "Welcome to the UOR Foundation community!")
        self.assertEqual(message_event.data["channel_data"]["name"], "general")

        identity_event = events[1]
        self.assertEqual(identity_event["id"], "7f9465854ddf5ab1456f32b64b2420eee9574ed3")
        self.assertEqual(identity_event["linked_event"], "25c235fe1d7f783a45c5d51b6f1d7eddf55f22fa")
        self.assertEqual(identity_event["type"], DISCORD_EVENT_MESSAGE_AUTHORED_BY)
        self.assertEqual(identity_event["source"], DISCORD_ORIGIN)
        self.assertEqual(identity_event["time"], 1793527200.0)
        self.assertEqual(identity_event.data["message"], "1566391350067331073")
        self.assertEqual(identity_event.data["name"], "Alice")
        self.assertEqual(identity_event.data["username"], "alice")
        self.assertIsNone(identity_event.data["email"])
        self.assertEqual(identity_event.data["uuid"], "4faae50ad20ba791f8c6516533035fa796b0cbe2")
        self.assertEqual(identity_event.data["user_id"], "1100000000000000001")
        self.assertFalse(identity_event.data["bot"])
        self.assertEqual(identity_event.data["role"], "authored_by")
        self.assertEqual(identity_event.data["source"], "discord")

    def test_eventize_item_bot_message(self):
        """Check if the bot flag of the author is kept and reactions are eventized"""

        eventizer = DiscordEventizer()

        events = eventizer.eventize_item(self.items[1])

        self.assertEqual(len(events), 3)

        message_event = events[0]
        self.assertEqual(message_event["id"], "6f722adbe88c60259a84a8705ded7bb01e823ec4")
        self.assertEqual(message_event["type"], DISCORD_EVENT_MESSAGE)
        self.assertEqual(message_event["time"], 1793622615.123)

        reaction_event = events[1]
        self.assertEqual(reaction_event["id"], "77405a81b2316df2010de2cbf91d4e8ac5c81733")
        self.assertEqual(reaction_event["linked_event"], "6f722adbe88c60259a84a8705ded7bb01e823ec4")
        self.assertEqual(reaction_event["type"], DISCORD_EVENT_MESSAGE_REACTION)
        self.assertEqual(reaction_event["source"], DISCORD_ORIGIN)
        # Discord gives no time for reactions; it is when they were observed
        self.assertEqual(reaction_event["time"], 1794604992.063727)
        self.assertEqual(reaction_event.data["message"], "1566791550099390466")
        self.assertIsNone(reaction_event.data["emoji_id"])
        self.assertEqual(reaction_event.data["emoji_name"], "👍")
        self.assertEqual(reaction_event.data["count"], 2)

        identity_event = events[2]
        self.assertEqual(identity_event["id"], "1705acccf8d9f754daac4c1b03e8890985e0946b")
        self.assertEqual(identity_event["type"], DISCORD_EVENT_MESSAGE_AUTHORED_BY)
        self.assertIsNone(identity_event.data["name"])
        self.assertEqual(identity_event.data["username"], "uor-digest")
        self.assertEqual(identity_event.data["uuid"], "f9978e33f2f318ed3ba76a1a4d27415ea84b3246")
        self.assertTrue(identity_event.data["bot"])

    def test_eventize_item_edited_reply(self):
        """Check if it produces edition, reply and mention events"""

        eventizer = DiscordEventizer()

        events = eventizer.eventize_item(self.items[2])

        self.assertEqual(len(events), 5)

        message_event = events[0]
        self.assertEqual(message_event["id"], "57a0c1b337224680450c0d7db14bc95e4a1855ab")
        self.assertEqual(message_event["type"], DISCORD_EVENT_MESSAGE)
        self.assertEqual(message_event["time"], 1793693100.0)

        edited_event = events[1]
        self.assertEqual(edited_event["id"], "5f5519abd79e9c62d2315b31b45d00dcbe13e072")
        self.assertEqual(edited_event["linked_event"], "57a0c1b337224680450c0d7db14bc95e4a1855ab")
        self.assertEqual(edited_event["type"], DISCORD_EVENT_MESSAGE_EDITED)
        self.assertEqual(edited_event["source"], DISCORD_ORIGIN)
        self.assertEqual(edited_event["time"], 1793693160.0)
        self.assertEqual(edited_event.data["message"], "1567087185100931075")
        self.assertEqual(edited_event.data["edited_timestamp"], "2026-11-03T08:06:00.000000+00:00")

        reply_event = events[2]
        self.assertEqual(reply_event["id"], "13f45efaa6e4573252553559bf03fe61389b5f64")
        self.assertEqual(reply_event["linked_event"], "57a0c1b337224680450c0d7db14bc95e4a1855ab")
        self.assertEqual(reply_event["type"], DISCORD_EVENT_MESSAGE_REPLY)
        self.assertEqual(reply_event["time"], 1793693100.0)
        self.assertEqual(reply_event.data["message"], "1567087185100931075")
        self.assertEqual(reply_event.data["replied_message"], "1566391350067331073")
        self.assertEqual(reply_event.data["replied_channel_id"], "1301234567890123457")
        self.assertEqual(reply_event.data["replied_guild_id"], "1301234567890123456")

        identity_event = events[3]
        self.assertEqual(identity_event["id"], "f86d4314188660d0c3fa1282661c0efe26356541")
        self.assertEqual(identity_event["type"], DISCORD_EVENT_MESSAGE_AUTHORED_BY)
        self.assertEqual(identity_event.data["username"], "bob")
        self.assertEqual(identity_event.data["uuid"], "903b03cec6cf24e98b7e841b85b511923118c387")
        self.assertFalse(identity_event.data["bot"])

        identity_event = events[4]
        self.assertEqual(identity_event["id"], "9fd53cc8846bde6a5ce7a85f9d5dcafcefd5b7fb")
        self.assertEqual(identity_event["linked_event"], "57a0c1b337224680450c0d7db14bc95e4a1855ab")
        self.assertEqual(identity_event["type"], DISCORD_EVENT_MESSAGE_MENTIONED)
        self.assertEqual(identity_event["time"], 1793693100.0)
        self.assertEqual(identity_event.data["message"], "1567087185100931075")
        self.assertEqual(identity_event.data["username"], "alice")
        self.assertEqual(identity_event.data["uuid"], "4faae50ad20ba791f8c6516533035fa796b0cbe2")
        self.assertEqual(identity_event.data["role"], "mentioned")
        self.assertFalse(identity_event.data["bot"])

    def test_eventize_item_thread(self):
        """Check if it produces a thread event from a message that started it"""

        eventizer = DiscordEventizer()

        events = eventizer.eventize_item(self.items[3])

        self.assertEqual(len(events), 6)

        self.assertEqual(events[0]["id"], "579dc9a10d9265a3c863eff43e5a304e6cd841b2")
        self.assertEqual(events[0]["type"], DISCORD_EVENT_MESSAGE)

        thread_event = events[1]
        self.assertEqual(thread_event["id"], "c29f29f85782f364e0ca6923da479e113a690e17")
        self.assertEqual(thread_event["linked_event"], "579dc9a10d9265a3c863eff43e5a304e6cd841b2")
        self.assertEqual(thread_event["type"], DISCORD_EVENT_THREAD_CREATED)
        self.assertEqual(thread_event["source"], DISCORD_ORIGIN)
        self.assertEqual(thread_event["time"], 1793783700.0)
        self.assertEqual(thread_event.data["message"], "1567467189043200000")
        self.assertEqual(thread_event.data["thread_id"], "1567467189043200000")
        self.assertEqual(thread_event.data["name"], "Release notes")
        self.assertEqual(thread_event.data["parent_id"], "1301234567890123457")
        self.assertEqual(thread_event.data["owner_id"], "1100000000000000004")

        reaction_event = events[2]
        self.assertEqual(reaction_event["id"], "aa7d14b74717e4e14ce7211a372cd9edf117c601")
        self.assertEqual(reaction_event["type"], DISCORD_EVENT_MESSAGE_REACTION)
        self.assertEqual(reaction_event.data["emoji_name"], "🎉")
        self.assertEqual(reaction_event.data["count"], 1)

        reaction_event = events[3]
        self.assertEqual(reaction_event["id"], "f6d168967e575255e10a813af2f12719d414a3b3")
        self.assertEqual(reaction_event["type"], DISCORD_EVENT_MESSAGE_REACTION)
        self.assertEqual(reaction_event.data["emoji_id"], "1200000000000000001")
        self.assertEqual(reaction_event.data["emoji_name"], "uor")
        self.assertEqual(reaction_event.data["count"], 3)

        identity_event = events[4]
        self.assertEqual(identity_event["id"], "bc77871440ff2202117855fd6b0e155f94bb220b")
        self.assertEqual(identity_event["type"], DISCORD_EVENT_MESSAGE_AUTHORED_BY)
        self.assertEqual(identity_event.data["username"], "carol")
        self.assertFalse(identity_event.data["bot"])

        identity_event = events[5]
        self.assertEqual(identity_event["id"], "79901d08152205a27e7afd369ba493ecf8fe8f80")
        self.assertEqual(identity_event["type"], DISCORD_EVENT_MESSAGE_MENTIONED)
        self.assertEqual(identity_event.data["username"], "uor-digest")
        self.assertTrue(identity_event.data["bot"])

    def test_eventize_item_thread_created_message(self):
        """Check if it produces a thread event from a THREAD_CREATED message"""

        eventizer = DiscordEventizer()

        raw_item = copy.deepcopy(self.items[0])
        raw_item["data"]["type"] = 18
        raw_item["data"]["content"] = "Onboarding"
        raw_item["data"]["message_reference"] = {
            "channel_id": "1566391350067331080",
            "guild_id": "1301234567890123456",
        }

        events = eventizer.eventize_item(raw_item)

        self.assertEqual(len(events), 3)

        self.assertEqual(events[0]["type"], DISCORD_EVENT_MESSAGE)

        thread_event = events[1]
        self.assertEqual(thread_event["id"], "dd77119b127c2f9e98cf532c562dd660dc7b29ff")
        self.assertEqual(thread_event["type"], DISCORD_EVENT_THREAD_CREATED)
        self.assertEqual(thread_event["time"], 1793527200.0)
        self.assertEqual(thread_event.data["thread_id"], "1566391350067331080")
        self.assertEqual(thread_event.data["name"], "Onboarding")
        self.assertEqual(thread_event.data["parent_id"], "1301234567890123457")
        self.assertEqual(thread_event.data["owner_id"], "1100000000000000001")

        self.assertEqual(events[2]["type"], DISCORD_EVENT_MESSAGE_AUTHORED_BY)

    def test_eventize_item_reference_not_reply(self):
        """Check if references that are not replies do not produce reply events"""

        eventizer = DiscordEventizer()

        # A pin notification references the pinned message
        raw_item = copy.deepcopy(self.items[0])
        raw_item["data"]["type"] = 6
        raw_item["data"]["message_reference"] = {
            "type": 0,
            "message_id": "1566391350067331073",
            "channel_id": "1301234567890123457",
        }

        events = eventizer.eventize_item(raw_item)
        types = [event["type"] for event in events]
        self.assertNotIn(DISCORD_EVENT_MESSAGE_REPLY, types)
        self.assertEqual(types, [DISCORD_EVENT_MESSAGE, DISCORD_EVENT_MESSAGE_AUTHORED_BY])

        # A forwarded message has a FORWARD reference
        raw_item = copy.deepcopy(self.items[2])
        raw_item["data"]["message_reference"]["type"] = 1

        events = eventizer.eventize_item(raw_item)
        types = [event["type"] for event in events]
        self.assertNotIn(DISCORD_EVENT_MESSAGE_REPLY, types)

    def test_eventize_item_edited_id(self):
        """Check if each edition of a message produces a different event"""

        eventizer = DiscordEventizer()

        raw_item = copy.deepcopy(self.items[2])
        raw_item["data"]["edited_timestamp"] = "2026-11-03T09:00:00.000000+00:00"

        events = eventizer.eventize_item(raw_item)

        edited_event = events[1]
        self.assertEqual(edited_event["type"], DISCORD_EVENT_MESSAGE_EDITED)
        self.assertNotEqual(edited_event["id"], "5f5519abd79e9c62d2315b31b45d00dcbe13e072")
        self.assertEqual(edited_event["time"], 1793696400.0)

    def test_eventize_item_invalid_identity(self):
        """Check if users without name nor username are skipped"""

        eventizer = DiscordEventizer()

        raw_item = copy.deepcopy(self.items[2])
        raw_item["data"]["mentions"][0]["username"] = ""
        raw_item["data"]["mentions"][0]["global_name"] = None

        with self.assertLogs("chronicler.events.core.discord", level="WARNING") as cm:
            events = eventizer.eventize_item(raw_item)

        self.assertEqual(len(events), 4)
        types = [event["type"] for event in events]
        self.assertNotIn(DISCORD_EVENT_MESSAGE_MENTIONED, types)
        self.assertIn("Cannot generate UUID for identity '1100000000000000001'", cm.output[0])

    def test_eventize_item_invalid_reaction(self):
        """Check if reactions without emoji are skipped"""

        eventizer = DiscordEventizer()

        raw_item = copy.deepcopy(self.items[1])
        raw_item["data"]["reactions"][0]["emoji"] = {"id": None, "name": None}

        with self.assertLogs("chronicler.events.core.discord", level="WARNING"):
            events = eventizer.eventize_item(raw_item)

        types = [event["type"] for event in events]
        self.assertEqual(types, [DISCORD_EVENT_MESSAGE, DISCORD_EVENT_MESSAGE_AUTHORED_BY])

    def test_eventize(self):
        """Check if eventizes a full set of items"""

        events = list(eventize("discord", self.items))
        self.assertEqual(len(events), 16)

        types = [event["type"] for event in events]
        self.assertEqual(types.count(DISCORD_EVENT_MESSAGE), 4)
        self.assertEqual(types.count(DISCORD_EVENT_MESSAGE_AUTHORED_BY), 4)
        self.assertEqual(types.count(DISCORD_EVENT_MESSAGE_MENTIONED), 2)
        self.assertEqual(types.count(DISCORD_EVENT_MESSAGE_REACTION), 3)
        self.assertEqual(types.count(DISCORD_EVENT_MESSAGE_EDITED), 1)
        self.assertEqual(types.count(DISCORD_EVENT_MESSAGE_REPLY), 1)
        self.assertEqual(types.count(DISCORD_EVENT_THREAD_CREATED), 1)

        ids = [event["id"] for event in events]
        self.assertEqual(len(ids), len(set(ids)))

    def test_eventize_item_invalid_backend(self):
        """Check invalid backend item type"""

        eventizer = DiscordEventizer()

        raw_item = {
            "backend_name": "Git",
            "category": "message",
            "uuid": "1234",
        }

        with self.assertRaises(ValueError) as context:
            _ = eventizer.eventize_item(raw_item)
        self.assertEqual(str(context.exception), "Item 1234 is not a 'discord' item.")

    def test_eventize_item_invalid_category(self):
        """Check invalid backend item category"""

        eventizer = DiscordEventizer()

        raw_item = {
            "backend_name": "Discord",
            "category": "channel",
            "uuid": "1234",
        }

        with self.assertRaises(ValueError) as context:
            _ = eventizer.eventize_item(raw_item)
        self.assertEqual(str(context.exception), "Invalid category 'channel' for '1234' item.")

    def test_eventize_item_no_uuid(self):
        """Check items without uuid"""

        eventizer = DiscordEventizer()

        raw_item = {
            "backend_name": "Discord",
            "category": "message",
        }

        with self.assertRaises(ValueError) as context:
            _ = eventizer.eventize_item(raw_item)
        self.assertEqual(str(context.exception), "'uuid' attribute not found on item.")


if __name__ == "__main__":
    unittest.main()
