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

import json
import logging

from grimoirelab_toolkit.datetime import (datetime_to_utc,
                                          datetime_utcnow,
                                          str_to_datetime)
from grimoirelab_toolkit.uris import urijoin

from ...backend import (Backend,
                        BackendCommand,
                        BackendCommandArgumentParser)
from ...client import HttpClient, RateLimitHandler
from ...errors import BackendError
from ...utils import DEFAULT_DATETIME


logger = logging.getLogger(__name__)

DISCORD_URL = 'https://discord.com/'
DISCORD_API_URL = 'https://discord.com/api/v10/'

# Discord's epoch (2015-01-01T00:00:00Z) in milliseconds; snowflake
# identifiers carry the milliseconds elapsed since it in their
# upper 42 bits.
DISCORD_EPOCH_MS = 1420070400000
SNOWFLAKE_TIMESTAMP_SHIFT = 22

CATEGORY_MESSAGE = "message"

# Maximum page size the messages endpoint accepts
MAX_ITEMS = 100

# Range before sleeping until rate limit reset
MIN_RATE_LIMIT = 1

# Default sleep time to deal with connection/server problems
DEFAULT_SLEEP_TIME = 1


def datetime_to_snowflake(dt):
    """Convert a datetime into the lowest Discord snowflake at that time.

    Messages created at `dt` or later have an identifier greater than or
    equal to the returned value. Dates before Discord's epoch are mapped
    to zero.

    :param dt: datetime to convert

    :returns: a snowflake (int)
    """
    ms = int(datetime_to_utc(dt).timestamp() * 1000)
    if ms <= DISCORD_EPOCH_MS:
        return 0
    return (ms - DISCORD_EPOCH_MS) << SNOWFLAKE_TIMESTAMP_SHIFT


class Discord(Backend):
    """Discord backend.

    This class retrieves the messages sent to a Discord channel. Threads
    and forum posts are channels in Discord, so their identifiers are
    valid channels too. To access the API a bot token is required; the
    bot must be a member of the guild with the `View Channel` and
    `Read Message History` permissions on the channel, and the
    `Message Content` privileged intent enabled so that `content` is
    returned.

    The origin of the data is the web URL of the channel,
    `https://discord.com/channels/<guild>/<channel>`.

    :param guild: identifier of the guild (server) the channel belongs to
    :param channel: identifier of the channel or thread
    :param api_token: bot token used to access the API
    :param max_items: maximum number of messages requested per query
    :param tag: label used to mark the data
    :param archive: archive to store/retrieve items
    :param sleep_for_rate: sleep until rate limit is reset
    :param min_rate_to_sleep: minimum rate needed to sleep until
         it will be reset
    :param sleep_time: time (in seconds) to sleep in case
        of connection problems
    :param ssl_verify: enable/disable SSL verification
    """
    version = '0.1.0'

    CATEGORIES = [CATEGORY_MESSAGE]
    EXTRA_SEARCH_FIELDS = {
        'guild_id': ['channel_data', 'guild_id'],
        'channel_id': ['channel_data', 'id'],
        'channel_name': ['channel_data', 'name'],
    }

    def __init__(self, guild, channel, api_token, max_items=MAX_ITEMS,
                 tag=None, archive=None,
                 sleep_for_rate=False, min_rate_to_sleep=MIN_RATE_LIMIT,
                 sleep_time=DEFAULT_SLEEP_TIME, ssl_verify=True):
        if not 1 <= max_items <= MAX_ITEMS:
            msg = "max_items must be between 1 and {}; {} given".format(MAX_ITEMS, max_items)
            raise ValueError(msg)

        origin = urijoin(DISCORD_URL, 'channels', guild, channel)

        super().__init__(origin, tag=tag, archive=archive, ssl_verify=ssl_verify)
        self.guild = guild
        self.channel = channel
        self.api_token = api_token
        self.max_items = max_items
        self.sleep_for_rate = sleep_for_rate
        self.min_rate_to_sleep = min_rate_to_sleep
        self.sleep_time = sleep_time
        self.client = None

    def fetch(self, category=CATEGORY_MESSAGE, from_date=DEFAULT_DATETIME):
        """Fetch the messages from the channel.

        This method fetches the messages sent to the channel since
        the given date, oldest first.

        :param category: the category of items to fetch
        :param from_date: obtain messages sent since this date

        :returns: a generator of messages
        """
        if not from_date:
            from_date = DEFAULT_DATETIME

        from_date = datetime_to_utc(from_date)

        kwargs = {'from_date': from_date}
        items = super().fetch(category, **kwargs)

        return items

    def fetch_items(self, category, **kwargs):
        """Fetch the messages.

        :param category: the category of items to fetch
        :param kwargs: backend arguments

        :returns: a generator of items
        """
        from_date = kwargs['from_date']

        logger.info("Fetching messages of '%s' channel from %s",
                    self.origin, str(from_date))

        raw_channel = self.client.channel(self.channel)
        channel_info = self.parse_json(raw_channel)

        guild_id = channel_info.get('guild_id')
        if guild_id != self.guild:
            msg = "channel {} belongs to guild {}, not to {}".format(
                self.channel, guild_id, self.guild)
            raise BackendError(cause=msg)

        # `after` is exclusive, so start one below the first snowflake
        # of `from_date` to include messages sent at that instant.
        after = max(datetime_to_snowflake(from_date) - 1, 0)
        nmsgs = 0

        while True:
            raw_messages = self.client.messages(self.channel, after=after)
            messages = self.parse_messages(raw_messages)

            # A page larger than the limit, or one holding a message that
            # is not newer than the cursor, breaks the paging contract;
            # following it could fetch forever, so it is refused.
            if len(messages) > self.max_items:
                msg = "page of {} messages exceeds the limit of {}".format(
                    len(messages), self.max_items)
                raise BackendError(cause=msg)
            if messages and int(messages[0]['id']) <= after:
                msg = "message {} is not after the cursor {}".format(
                    messages[0]['id'], after)
                raise BackendError(cause=msg)

            for message in messages:
                message['channel_data'] = channel_info
                yield message
                nmsgs += 1

            if len(messages) < self.max_items:
                break

            after = int(messages[-1]['id'])

        logger.info("Fetch process completed: %s messages fetched", nmsgs)

    @classmethod
    def has_archiving(cls):
        """Returns whether it supports archiving items on the fetch process.

        :returns: this backend supports items archive
        """
        return True

    @classmethod
    def has_resuming(cls):
        """Returns whether it supports to resume the fetch process.

        :returns: this backend supports items resuming
        """
        return True

    @staticmethod
    def metadata_id(item):
        """Extracts the identifier from a Discord item."""

        return str(item['id'])

    @staticmethod
    def metadata_updated_on(item):
        """Extracts and converts the update time from a Discord item.

        The time is taken from the `timestamp` field, the moment the
        message was sent. Items are fetched in that order, so it is
        the field that makes incremental fetching consistent. Later
        edits are kept in `edited_timestamp`.

        :param item: item generated by the backend

        :returns: a UNIX timestamp
        """
        ts = str_to_datetime(item['timestamp'])

        return ts.timestamp()

    @staticmethod
    def metadata_category(item):
        """Extracts the category from a Discord item.

        This backend only generates one type of item which is
        'message'.
        """
        return CATEGORY_MESSAGE

    @staticmethod
    def parse_json(raw_json):
        """Parse a Discord JSON stream.

        :param raw_json: JSON string to parse

        :returns: a dict with the parsed data
        """
        return json.loads(raw_json)

    @staticmethod
    def parse_messages(raw_messages):
        """Parse a page of Discord messages, oldest first.

        The API returns a page newest first. Snowflakes grow with time,
        so ordering by identifier yields the messages in the order they
        were sent.

        :param raw_messages: JSON string with a list of messages

        :returns: a list of messages sorted by identifier
        """
        messages = json.loads(raw_messages)
        messages.sort(key=lambda m: int(m['id']))
        return messages

    def _init_client(self, from_archive=False):
        """Init client"""

        return DiscordClient(self.api_token,
                             max_items=self.max_items,
                             sleep_for_rate=self.sleep_for_rate,
                             min_rate_to_sleep=self.min_rate_to_sleep,
                             sleep_time=self.sleep_time,
                             archive=self.archive, from_archive=from_archive,
                             ssl_verify=self.ssl_verify)


class DiscordClient(HttpClient, RateLimitHandler):
    """Discord API client.

    Client for fetching information from Discord using its
    REST API v10.

    :param api_token: bot token needed to use the API
    :param max_items: maximum number of items fetched per request
    :param sleep_for_rate: sleep until rate limit is reset
    :param min_rate_to_sleep: minimum rate needed to sleep until
         it will be reset
    :param sleep_time: time (in seconds) to sleep in case
        of connection problems
    :param archive: an archive to store/read fetched data
    :param from_archive: it tells whether to write/read the archive
    :param ssl_verify: enable/disable SSL verification
    """
    # API resources
    RCHANNELS = 'channels'
    RMESSAGES = 'messages'

    # API headers
    HAUTHORIZATION = 'Authorization'
    RATE_LIMIT_RESET_AFTER_HEADER = 'X-RateLimit-Reset-After'

    # Resource parameters
    PAFTER = 'after'
    PLIMIT = 'limit'

    def __init__(self, api_token, max_items=MAX_ITEMS,
                 sleep_for_rate=False, min_rate_to_sleep=MIN_RATE_LIMIT,
                 sleep_time=DEFAULT_SLEEP_TIME,
                 archive=None, from_archive=False, ssl_verify=True):
        self.api_token = api_token
        self.max_items = max_items

        super().__init__(DISCORD_API_URL,
                         sleep_time=sleep_time,
                         extra_headers=self._set_extra_headers(),
                         archive=archive, from_archive=from_archive,
                         ssl_verify=ssl_verify)
        super().setup_rate_limit_handler(sleep_for_rate=sleep_for_rate,
                                         min_rate_to_sleep=min_rate_to_sleep)

        # The archive pickles the whole response, and a response keeps the
        # request that was sent, with the session's Authorization header.
        # sanitize_for_archive only sees the per-request headers, so the
        # token is removed from the response before it is archived.
        if archive and not from_archive:
            self.session.hooks['response'].append(self._remove_token)

    def channel(self, channel):
        """Fetch the channel information"""

        url = urijoin(self.base_url, self.RCHANNELS, channel)

        return self.fetch(url).text

    def messages(self, channel, after=0):
        """Fetch a page of messages sent after the `after` snowflake."""

        url = urijoin(self.base_url, self.RCHANNELS, channel, self.RMESSAGES)
        params = {
            self.PAFTER: after,
            self.PLIMIT: self.max_items
        }

        logger.debug("Discord client requests: %s params: %s", url, str(params))

        return self.fetch(url, payload=params).text

    def fetch(self, url, payload=None, headers=None, method=HttpClient.GET, stream=False, auth=None):
        """Override fetch method to handle API rate limit.

        :param url: link to the resource
        :param payload: payload of the request
        :param headers: headers of the request
        :param method: type of request call (GET or POST)
        :param stream: defer downloading the response body until the response content is available
        :param auth: auth of the request

        :returns a response object
        """
        if not self.from_archive:
            self.sleep_for_rate_limit()

        response = super().fetch(url, payload, headers, method, stream)

        if not self.from_archive:
            self.update_rate_limit(response)

        return response

    def update_rate_limit(self, response):
        """Update the rate limit and the time to reset.

        Discord sends `X-RateLimit-Reset` as epoch seconds with a
        fractional part, which the generic handler cannot parse, and
        `X-RateLimit-Reset-After` as the seconds left until the reset.
        """
        if self.rate_limit_header in response.headers:
            self.rate_limit = int(response.headers[self.rate_limit_header])
            logger.debug("Rate limit: %s", self.rate_limit)
        else:
            self.rate_limit = None

        # The relative header does not depend on the local clock agreeing
        # with Discord's, so it is preferred when both are sent.
        if self.RATE_LIMIT_RESET_AFTER_HEADER in response.headers:
            reset_after = float(response.headers[self.RATE_LIMIT_RESET_AFTER_HEADER])
            self.rate_limit_reset_ts = datetime_utcnow().timestamp() + reset_after
            logger.debug("Rate limit reset: %s", self.calculate_time_to_reset())
        elif self.rate_limit_reset_header in response.headers:
            self.rate_limit_reset_ts = float(response.headers[self.rate_limit_reset_header])
            logger.debug("Rate limit reset: %s", self.calculate_time_to_reset())
        else:
            self.rate_limit_reset_ts = None

    def calculate_time_to_reset(self):
        """Number of seconds to wait until the bucket is refilled."""

        current_epoch = datetime_utcnow().timestamp()
        time_to_reset = int(self.rate_limit_reset_ts - current_epoch) + 1

        if time_to_reset < 0:
            time_to_reset = 0

        return time_to_reset

    @classmethod
    def _remove_token(cls, response, *args, **kwargs):
        """Remove the token from the request a response keeps."""

        response.request.headers.pop(cls.HAUTHORIZATION, None)
        return response

    def _set_extra_headers(self):
        """Set authentication tokens."""

        return {self.HAUTHORIZATION: 'Bot ' + self.api_token}

    @staticmethod
    def sanitize_for_archive(url, headers, payload):
        """Sanitize the request by removing the token before
        storing/retrieving archived items.

        :param: url: HTTP url request
        :param: headers: HTTP headers request
        :param: payload: HTTP payload request

        :returns url, headers and the sanitized payload
        """
        if headers and DiscordClient.HAUTHORIZATION in headers:
            headers.pop(DiscordClient.HAUTHORIZATION, None)

        return url, headers, payload


class DiscordCommand(BackendCommand):
    """Class to run Discord backend from the command line."""

    BACKEND = Discord

    @classmethod
    def setup_cmd_parser(cls):
        """Returns the Discord argument parser."""

        parser = BackendCommandArgumentParser(cls.BACKEND,
                                              from_date=True,
                                              token_auth=True,
                                              archive=True,
                                              ssl_verify=True)

        # Discord options
        group = parser.parser.add_argument_group('Discord arguments')
        group.add_argument('--max-items', dest='max_items',
                           type=int, default=MAX_ITEMS,
                           help="maximum number of items requested on the same query (1-100)")
        group.add_argument('--sleep-for-rate', dest='sleep_for_rate',
                           action='store_true',
                           help="sleep for getting more rate")
        group.add_argument('--min-rate-to-sleep', dest='min_rate_to_sleep',
                           default=MIN_RATE_LIMIT, type=int,
                           help="sleep until reset when the rate limit reaches this value")
        group.add_argument('--sleep-time', dest='sleep_time',
                           default=DEFAULT_SLEEP_TIME, type=int,
                           help="minimum sleeping time to avoid too many request exception")

        # Positional arguments
        parser.parser.add_argument('guild',
                                   help="Discord guild (server) identifier")
        parser.parser.add_argument('channel',
                                   help="Discord channel or thread identifier")

        return parser
