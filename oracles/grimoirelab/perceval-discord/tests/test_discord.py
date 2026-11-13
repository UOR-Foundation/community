#!/usr/bin/env python3
# -*- coding: utf-8 -*-
#
# Copyright (C) 2026 UOR Foundation
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
import datetime
import json
import os
import unittest
import unittest.mock

import httpretty

from grimoirelab_toolkit.datetime import datetime_utcnow

from perceval.backend import BackendCommandArgumentParser, uuid
from perceval.errors import BackendError, RateLimitError
from perceval.utils import DEFAULT_DATETIME
from perceval.backends.core.discord import (Discord,
                                            DiscordClient,
                                            DiscordCommand,
                                            datetime_to_snowflake,
                                            MAX_ITEMS)
from base import TestCaseBackendArchive


DISCORD_API_URL = 'https://discord.com/api/v10'
GUILD_ID = '1301234567890123456'
CHANNEL_ID = '1301234567890123457'
DISCORD_CHANNEL_URL = DISCORD_API_URL + '/channels/' + CHANNEL_ID
DISCORD_MESSAGES_URL = DISCORD_CHANNEL_URL + '/messages'
DISCORD_ORIGIN = 'https://discord.com/channels/' + GUILD_ID + '/' + CHANNEL_ID

MSG_WELCOME = '1566391350067331073'
MSG_DIGEST = '1566791550099390466'
MSG_REPLY = '1567087185100931075'


def read_file(filename, mode='r'):
    with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), filename), mode) as f:
        content = f.read()
    return content


def setup_http_server(channel_file='data/discord/discord_channel.json',
                      rate_limit_headers=None, page_filter=None):
    """Setup a mock HTTP server that serves the messages endpoint as Discord does.

    The pool of messages is filtered by the `after` snowflake and cut at
    `limit`, taking the oldest messages after the snowflake and returning
    them newest first. `page_filter` replaces that selection, to serve
    pages that break the paging contract.
    """
    http_requests = []

    channel = read_file(channel_file, 'rb')
    pool = json.loads(read_file('data/discord/discord_messages.json'))
    pool += json.loads(read_file('data/discord/discord_messages_next.json'))
    pool.sort(key=lambda m: int(m['id']))

    def messages_callback(request, uri, headers):
        params = request.querystring
        after = int(params['after'][0])
        limit = int(params['limit'][0])
        if page_filter:
            page = page_filter(pool, after, limit)
        else:
            page = [m for m in pool if int(m['id']) > after][:limit]
        page.reverse()
        http_requests.append(request)
        return (200, headers, json.dumps(page))

    def channel_callback(request, uri, headers):
        http_requests.append(request)
        return (200, headers, channel)

    headers = rate_limit_headers or {}

    httpretty.register_uri(httpretty.GET,
                           DISCORD_CHANNEL_URL,
                           responses=[httpretty.Response(body=channel_callback,
                                                         adding_headers=headers)])
    httpretty.register_uri(httpretty.GET,
                           DISCORD_MESSAGES_URL,
                           responses=[httpretty.Response(body=messages_callback,
                                                         adding_headers=headers)])

    return http_requests


class TestDiscordBackend(unittest.TestCase):
    """Discord backend tests"""

    def test_initialization(self):
        """Test whether attributes are initialized"""

        discord = Discord(GUILD_ID, CHANNEL_ID, 'aaaa', max_items=5, tag='test')

        self.assertEqual(discord.origin, DISCORD_ORIGIN)
        self.assertEqual(discord.tag, 'test')
        self.assertEqual(discord.guild, GUILD_ID)
        self.assertEqual(discord.channel, CHANNEL_ID)
        self.assertEqual(discord.max_items, 5)
        self.assertFalse(discord.sleep_for_rate)
        self.assertIsNone(discord.client)
        self.assertTrue(discord.ssl_verify)

        # When tag is empty or None it will be set to the value in origin
        discord = Discord(GUILD_ID, CHANNEL_ID, 'aaaa', ssl_verify=False)
        self.assertEqual(discord.tag, DISCORD_ORIGIN)
        self.assertEqual(discord.max_items, MAX_ITEMS)
        self.assertFalse(discord.ssl_verify)

        discord = Discord(GUILD_ID, CHANNEL_ID, 'aaaa', tag='')
        self.assertEqual(discord.tag, DISCORD_ORIGIN)

    def test_initialization_max_items(self):
        """Test whether a page size the API refuses is rejected"""

        for value in (0, MAX_ITEMS + 1):
            with self.assertRaises(ValueError):
                Discord(GUILD_ID, CHANNEL_ID, 'aaaa', max_items=value)

    def test_has_archiving(self):
        """Test if it returns True when has_archiving is called"""

        self.assertTrue(Discord.has_archiving())

    def test_has_resuming(self):
        """Test if it returns True when has_resuming is called"""

        self.assertTrue(Discord.has_resuming())

    @httpretty.activate
    def test_fetch(self):
        """Test whether it fetches every message, oldest first"""

        http_requests = setup_http_server()

        discord = Discord(GUILD_ID, CHANNEL_ID, 'aaaa')
        messages = [m for m in discord.fetch(from_date=None)]

        self.assertEqual(len(messages), 3)

        expected = [
            (MSG_WELCOME, 'Welcome to the UOR Foundation community!', 1793527200.0, 'alice'),
            (MSG_DIGEST, 'Daily digest: 3 new pull requests.', 1793622615.123, 'uor-digest'),
            (MSG_REPLY, 'Thanks <@1100000000000000001>!', 1793693100.0, 'bob'),
        ]

        for message, (mid, content, ts, author) in zip(messages, expected):
            self.assertEqual(message['data']['id'], mid)
            self.assertEqual(message['data']['content'], content)
            self.assertEqual(message['data']['author']['username'], author)
            self.assertEqual(message['data']['channel_data']['id'], CHANNEL_ID)
            self.assertEqual(message['data']['channel_data']['guild_id'], GUILD_ID)
            self.assertEqual(message['origin'], DISCORD_ORIGIN)
            self.assertEqual(message['uuid'], uuid(DISCORD_ORIGIN, mid))
            self.assertEqual(message['updated_on'], ts)
            self.assertEqual(message['category'], 'message')
            self.assertEqual(message['tag'], DISCORD_ORIGIN)

        # Bots are flagged by Discord; the flag is kept so that agents
        # can be told apart from people downstream
        self.assertTrue(messages[1]['data']['author']['bot'])
        self.assertNotIn('bot', messages[0]['data']['author'])
        self.assertEqual(messages[2]['data']['edited_timestamp'],
                         '2026-11-03T08:06:00.000000+00:00')

        # Check requests
        self.assertEqual(len(http_requests), 2)
        self.assertEqual(http_requests[0].path, '/api/v10/channels/' + CHANNEL_ID)
        self.assertDictEqual(http_requests[1].querystring,
                             {'after': ['0'], 'limit': ['100']})
        for req in http_requests:
            self.assertEqual(req.headers['Authorization'], 'Bot aaaa')

    @httpretty.activate
    def test_fetch_pagination(self):
        """Test whether it follows the `after` snowflake across pages"""

        http_requests = setup_http_server()

        discord = Discord(GUILD_ID, CHANNEL_ID, 'aaaa', max_items=2)
        messages = [m for m in discord.fetch()]

        self.assertEqual([m['data']['id'] for m in messages],
                         [MSG_WELCOME, MSG_DIGEST, MSG_REPLY])

        self.assertEqual(len(http_requests), 3)
        self.assertDictEqual(http_requests[1].querystring,
                             {'after': ['0'], 'limit': ['2']})
        self.assertDictEqual(http_requests[2].querystring,
                             {'after': [MSG_DIGEST], 'limit': ['2']})

    @httpretty.activate
    def test_fetch_pagination_full_last_page(self):
        """Test whether a full last page is followed by one empty page"""

        http_requests = setup_http_server()

        discord = Discord(GUILD_ID, CHANNEL_ID, 'aaaa', max_items=1)
        messages = [m for m in discord.fetch()]

        self.assertEqual(len(messages), 3)
        self.assertEqual(len(http_requests), 5)
        self.assertDictEqual(http_requests[4].querystring,
                             {'after': [MSG_REPLY], 'limit': ['1']})

    @httpretty.activate
    def test_fetch_from_date(self):
        """Test whether it fetches the messages sent since a date"""

        http_requests = setup_http_server()

        from_date = datetime.datetime(2026, 11, 2, tzinfo=datetime.timezone.utc)
        discord = Discord(GUILD_ID, CHANNEL_ID, 'aaaa')
        messages = [m for m in discord.fetch(from_date=from_date)]

        self.assertEqual([m['data']['id'] for m in messages], [MSG_DIGEST, MSG_REPLY])
        self.assertDictEqual(http_requests[1].querystring,
                             {'after': [str(datetime_to_snowflake(from_date) - 1)],
                              'limit': ['100']})

    @httpretty.activate
    def test_fetch_from_exact_date(self):
        """Test whether a message sent at `from_date` is included"""

        setup_http_server()

        from_date = datetime.datetime(2026, 11, 2, 12, 30, 15, 123000,
                                      tzinfo=datetime.timezone.utc)
        discord = Discord(GUILD_ID, CHANNEL_ID, 'aaaa')
        messages = [m for m in discord.fetch(from_date=from_date)]

        self.assertEqual([m['data']['id'] for m in messages], [MSG_DIGEST, MSG_REPLY])

    @httpretty.activate
    def test_fetch_empty(self):
        """Test whether it works when there are no messages"""

        setup_http_server()

        from_date = datetime.datetime(2027, 1, 1, tzinfo=datetime.timezone.utc)
        discord = Discord(GUILD_ID, CHANNEL_ID, 'aaaa')
        messages = [m for m in discord.fetch(from_date=from_date)]

        self.assertListEqual(messages, [])

    @httpretty.activate
    def test_fetch_wrong_guild(self):
        """Test whether a channel of another guild is refused"""

        setup_http_server(channel_file='data/discord/discord_channel_other_guild.json')

        discord = Discord(GUILD_ID, CHANNEL_ID, 'aaaa')

        with self.assertRaises(BackendError):
            _ = [m for m in discord.fetch()]

    @httpretty.activate
    def test_fetch_oversized_page(self):
        """Test whether a page larger than the limit is refused"""

        setup_http_server(page_filter=lambda pool, after, limit: pool)

        discord = Discord(GUILD_ID, CHANNEL_ID, 'aaaa', max_items=2)

        with self.assertRaisesRegex(BackendError, 'page of 3 messages exceeds the limit of 2'):
            _ = [m for m in discord.fetch()]

    @httpretty.activate
    def test_fetch_stale_page(self):
        """Test whether a page not newer than the cursor is refused"""

        # The server ignores `after` and serves the first page again,
        # which would make the fetch loop forever
        setup_http_server(page_filter=lambda pool, after, limit: pool[:limit])

        discord = Discord(GUILD_ID, CHANNEL_ID, 'aaaa', max_items=2)
        messages = []

        with self.assertRaisesRegex(BackendError, 'is not after the cursor ' + MSG_DIGEST):
            for message in discord.fetch():
                messages.append(message)

        self.assertEqual([m['data']['id'] for m in messages], [MSG_WELCOME, MSG_DIGEST])

    @httpretty.activate
    def test_search_fields(self):
        """Test whether the search_fields is properly set"""

        setup_http_server()

        discord = Discord(GUILD_ID, CHANNEL_ID, 'aaaa')
        messages = [m for m in discord.fetch()]

        for message in messages:
            self.assertEqual(discord.metadata_id(message['data']), message['search_fields']['item_id'])
            self.assertEqual(message['search_fields']['guild_id'], GUILD_ID)
            self.assertEqual(message['search_fields']['channel_id'], CHANNEL_ID)
            self.assertEqual(message['search_fields']['channel_name'], 'general')

    def test_parse_messages(self):
        """Test whether a page is parsed oldest first"""

        raw = read_file('data/discord/discord_messages.json')
        messages = Discord.parse_messages(raw)

        self.assertEqual([m['id'] for m in messages], [MSG_WELCOME, MSG_DIGEST])
        self.assertListEqual(Discord.parse_messages('[]'), [])

    def test_datetime_to_snowflake(self):
        """Test the conversion of dates into snowflakes"""

        self.assertEqual(datetime_to_snowflake(DEFAULT_DATETIME), 0)

        epoch = datetime.datetime(2015, 1, 1, tzinfo=datetime.timezone.utc)
        self.assertEqual(datetime_to_snowflake(epoch), 0)

        dt = datetime.datetime(2026, 11, 1, 10, 0, tzinfo=datetime.timezone.utc)
        sf = datetime_to_snowflake(dt)
        self.assertLessEqual(sf, int(MSG_WELCOME))
        self.assertEqual(sf >> 22, int(MSG_WELCOME) >> 22)


class TestDiscordBackendArchive(TestCaseBackendArchive):
    """Discord backend tests using an archive (offline replay)"""

    def setUp(self):
        super().setUp()
        self.backend_write_archive = Discord(GUILD_ID, CHANNEL_ID, 'aaaa',
                                             max_items=2, archive=self.archive)
        self.backend_read_archive = Discord(GUILD_ID, CHANNEL_ID, 'bbbb',
                                            max_items=2, archive=self.archive)

    @httpretty.activate
    def test_fetch_from_archive(self):
        """Test whether it replays every message from the archive"""

        setup_http_server()
        self._test_fetch_from_archive(from_date=None)

    @httpretty.activate
    def test_fetch_from_date_from_archive(self):
        """Test whether it replays the messages since a date"""

        setup_http_server()
        from_date = datetime.datetime(2026, 11, 2, tzinfo=datetime.timezone.utc)
        self._test_fetch_from_archive(from_date=from_date)

    @httpretty.activate
    def test_fetch_empty_from_archive(self):
        """Test whether it replays an empty channel"""

        setup_http_server()
        from_date = datetime.datetime(2027, 1, 1, tzinfo=datetime.timezone.utc)
        self._test_fetch_from_archive(from_date=from_date)


class TestDiscordClient(unittest.TestCase):
    """Discord API client tests"""

    def test_init(self):
        """Test initialization"""

        client = DiscordClient('aaaa', max_items=5)

        self.assertEqual(client.base_url, 'https://discord.com/api/v10/')
        self.assertEqual(client.api_token, 'aaaa')
        self.assertEqual(client.max_items, 5)
        self.assertEqual(client.session.headers['Authorization'], 'Bot aaaa')
        self.assertFalse(client.sleep_for_rate)
        self.assertTrue(client.ssl_verify)

    @httpretty.activate
    def test_messages(self):
        """Test messages API call"""

        http_requests = setup_http_server()

        client = DiscordClient('aaaa', max_items=2)
        page = json.loads(client.messages(CHANNEL_ID, after=int(MSG_WELCOME)))

        self.assertEqual([m['id'] for m in page], [MSG_REPLY, MSG_DIGEST])
        self.assertDictEqual(http_requests[0].querystring,
                             {'after': [MSG_WELCOME], 'limit': ['2']})

    @httpretty.activate
    def test_rate_limit_headers(self):
        """Test whether Discord's fractional reset header is parsed"""

        reset = datetime_utcnow().timestamp() + 2.5
        setup_http_server(rate_limit_headers={'X-RateLimit-Remaining': '4',
                                              'X-RateLimit-Reset': '%.3f' % reset})

        client = DiscordClient('aaaa')
        client.channel(CHANNEL_ID)

        self.assertEqual(client.rate_limit, 4)
        self.assertAlmostEqual(client.rate_limit_reset_ts, reset, places=2)
        self.assertIn(client.calculate_time_to_reset(), (2, 3))

    @httpretty.activate
    def test_rate_limit_error(self):
        """Test whether an exhausted bucket raises when not sleeping"""

        reset = datetime_utcnow().timestamp() + 30
        setup_http_server(rate_limit_headers={'X-RateLimit-Remaining': '0',
                                              'X-RateLimit-Reset': '%.3f' % reset})

        client = DiscordClient('aaaa', sleep_for_rate=False)
        client.channel(CHANNEL_ID)

        with self.assertRaises(RateLimitError):
            client.channel(CHANNEL_ID)

    @httpretty.activate
    @unittest.mock.patch('perceval.client.time.sleep')
    def test_sleep_for_rate(self, mock_sleep):
        """Test whether it sleeps until the bucket is refilled"""

        reset = datetime_utcnow().timestamp() + 5
        setup_http_server(rate_limit_headers={'X-RateLimit-Remaining': '0',
                                              'X-RateLimit-Reset': '%.3f' % reset})

        client = DiscordClient('aaaa', sleep_for_rate=True)
        client.channel(CHANNEL_ID)
        client.channel(CHANNEL_ID)

        mock_sleep.assert_called_once()
        self.assertIn(mock_sleep.call_args[0][0], (5, 6))

    def test_calculate_time_to_reset_past(self):
        """Test whether a reset in the past waits zero seconds"""

        client = DiscordClient('aaaa')
        client.rate_limit_reset_ts = datetime_utcnow().timestamp() - 10

        self.assertEqual(client.calculate_time_to_reset(), 0)

    def test_sanitize_for_archive(self):
        """Test whether the sanitize method removes the token"""

        url = "http://example.com"
        headers = {DiscordClient.HAUTHORIZATION: 'Bot aaaa'}
        c_headers = copy.deepcopy(headers)
        payload = {'after': 0, 'limit': 100}

        san_u, san_h, san_p = DiscordClient.sanitize_for_archive(url, c_headers, payload)
        headers.pop(DiscordClient.HAUTHORIZATION)

        self.assertEqual(url, san_u)
        self.assertEqual(headers, san_h)
        self.assertEqual(payload, san_p)

        self.assertEqual(DiscordClient.sanitize_for_archive(url, None, payload),
                         (url, None, payload))


class TestDiscordCommand(unittest.TestCase):
    """Tests for DiscordCommand class"""

    def test_backend_class(self):
        """Test if the backend class is Discord"""

        self.assertIs(DiscordCommand.BACKEND, Discord)

    def test_setup_cmd_parser(self):
        """Test if it parser object is correctly initialized"""

        parser = DiscordCommand.setup_cmd_parser()
        self.assertIsInstance(parser, BackendCommandArgumentParser)
        self.assertEqual(parser._backend, Discord)

        args = [GUILD_ID, CHANNEL_ID,
                '--api-token', 'aaaa',
                '--max-items', '5',
                '--tag', 'test',
                '--no-archive',
                '--from-date', '1970-01-01',
                '--sleep-for-rate',
                '--min-rate-to-sleep', '10',
                '--sleep-time', '10',
                '--no-ssl-verify']

        parsed_args = parser.parse(*args)
        self.assertEqual(parsed_args.guild, GUILD_ID)
        self.assertEqual(parsed_args.channel, CHANNEL_ID)
        self.assertEqual(parsed_args.api_token, 'aaaa')
        self.assertEqual(parsed_args.max_items, 5)
        self.assertEqual(parsed_args.tag, 'test')
        self.assertTrue(parsed_args.no_archive)
        self.assertEqual(parsed_args.from_date, DEFAULT_DATETIME)
        self.assertTrue(parsed_args.sleep_for_rate)
        self.assertEqual(parsed_args.min_rate_to_sleep, 10)
        self.assertEqual(parsed_args.sleep_time, 10)
        self.assertFalse(parsed_args.ssl_verify)


if __name__ == "__main__":
    unittest.main(warnings='ignore')
