import json
import os
import re
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any


CHANNEL_ID = "UCMxGPWLjDHRQ9xoLHCXd45g"
DATA_FILE = Path(__file__).resolve().parents[1] / "channel-data.json"
API_BASE = "https://www.googleapis.com/youtube/v3"
SHORTS_MAX_SECONDS = 120
SCHEDULE_REFRESH_INTERVAL = timedelta(hours=6)


def fetch_api(resource: str, params: dict[str, str]) -> dict[str, Any]:
    api_key = os.environ.get("YOUTUBE_API_KEY")
    if not api_key:
        raise RuntimeError(
            "YOUTUBE_API_KEY is missing. Add it as a GitHub Actions secret."
        )

    query = urllib.parse.urlencode({**params, "key": api_key})
    request = urllib.request.Request(
        f"{API_BASE}/{resource}?{query}",
        headers={"Accept": "application/json", "User-Agent": "GamingChannelSite/1.0"},
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            data = json.loads(response.read())
    except urllib.error.HTTPError as error:
        raise RuntimeError(
            f"YouTube {resource} request failed with HTTP {error.code}."
        ) from None
    except urllib.error.URLError as error:
        raise RuntimeError(
            f"YouTube {resource} request failed: {error.reason}."
        ) from None

    if not isinstance(data, dict) or data.get("error"):
        raise RuntimeError(f"YouTube {resource} returned an invalid response.")
    return data


def parse_duration(value: str) -> int | None:
    match = re.fullmatch(
        r"PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?",
        value,
    )
    if match is None:
        return None
    hours, minutes, seconds = (int(part or 0) for part in match.groups())
    return hours * 3600 + minutes * 60 + seconds


def load_existing_data() -> dict[str, Any]:
    try:
        data = json.loads(DATA_FILE.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return {}
    if not isinstance(data, dict):
        raise ValueError("channel-data.json must contain a JSON object.")
    return data


def unique_ids(*groups: list[str]) -> list[str]:
    result: list[str] = []
    seen: set[str] = set()
    for group in groups:
        for video_id in group:
            if video_id not in seen:
                seen.add(video_id)
                result.append(video_id)
    return result


def video_ids_from_search(result: dict[str, Any]) -> list[str]:
    items = result.get("items", [])
    if not isinstance(items, list):
        raise ValueError("YouTube search results have an invalid format.")
    return [
        item["id"]["videoId"]
        for item in items
        if isinstance(item, dict)
        and isinstance(item.get("id"), dict)
        and isinstance(item["id"].get("videoId"), str)
    ]


def main() -> None:
    now = datetime.now(timezone.utc)
    now_iso = now.isoformat()
    existing = load_existing_data()

    channel_result = fetch_api(
        "channels",
        {"part": "statistics,contentDetails", "id": CHANNEL_ID},
    )
    channels = channel_result.get("items")
    if not isinstance(channels, list) or not channels or not isinstance(channels[0], dict):
        raise RuntimeError("YouTube did not return the configured channel.")

    channel = channels[0]
    statistics = channel.get("statistics", {})
    subscriber_count = statistics.get("subscriberCount") if isinstance(statistics, dict) else None
    if not isinstance(subscriber_count, str) or not subscriber_count.isdigit():
        subscriber_count = None

    content_details = channel.get("contentDetails", {})
    related_playlists = (
        content_details.get("relatedPlaylists", {})
        if isinstance(content_details, dict)
        else {}
    )
    uploads_id = (
        related_playlists.get("uploads")
        if isinstance(related_playlists, dict)
        else None
    )
    if not isinstance(uploads_id, str):
        raise RuntimeError("YouTube did not return the channel uploads playlist.")

    playlist_result = fetch_api(
        "playlistItems",
        {"part": "contentDetails", "playlistId": uploads_id, "maxResults": "20"},
    )
    playlist_items = playlist_result.get("items", [])
    if not isinstance(playlist_items, list):
        raise ValueError("YouTube uploads playlist has an invalid format.")
    upload_ids = [
        item["contentDetails"]["videoId"]
        for item in playlist_items
        if isinstance(item, dict)
        and isinstance(item.get("contentDetails"), dict)
        and isinstance(item["contentDetails"].get("videoId"), str)
    ]

    live_result = fetch_api(
        "search",
        {
            "part": "snippet",
            "channelId": CHANNEL_ID,
            "type": "video",
            "eventType": "live",
            "maxResults": "5",
        },
    )
    live_ids = video_ids_from_search(live_result)

    schedule_updated_at = existing.get("scheduleUpdatedAt")
    try:
        last_schedule_update = datetime.fromisoformat(schedule_updated_at)
        if last_schedule_update.tzinfo is None:
            last_schedule_update = last_schedule_update.replace(tzinfo=timezone.utc)
    except (TypeError, ValueError):
        last_schedule_update = None
    refresh_schedule = (
        last_schedule_update is None
        or now - last_schedule_update >= SCHEDULE_REFRESH_INTERVAL
    )

    if refresh_schedule:
        upcoming_result = fetch_api(
            "search",
            {
                "part": "snippet",
                "channelId": CHANNEL_ID,
                "type": "video",
                "eventType": "upcoming",
                "maxResults": "25",
                "order": "date",
            },
        )
        upcoming_ids = video_ids_from_search(upcoming_result)
    else:
        upcoming_ids = [
            stream["videoId"]
            for stream in existing.get("upcomingStreams", [])
            if isinstance(stream, dict) and isinstance(stream.get("videoId"), str)
        ]

    requested_ids = unique_ids(upload_ids, live_ids, upcoming_ids)
    videos_by_id: dict[str, dict[str, Any]] = {}
    if requested_ids:
        videos_result = fetch_api(
            "videos",
            {
                "part": "snippet,contentDetails,liveStreamingDetails",
                "id": ",".join(requested_ids[:50]),
            },
        )
        video_items = videos_result.get("items", [])
        if not isinstance(video_items, list):
            raise ValueError("YouTube video details have an invalid format.")
        videos_by_id = {
            video["id"]: video
            for video in video_items
            if isinstance(video, dict) and isinstance(video.get("id"), str)
        }

    short_videos: list[dict[str, Any]] = []
    long_videos: list[dict[str, Any]] = []
    for video_id in upload_ids:
        video = videos_by_id.get(video_id)
        if not isinstance(video, dict):
            continue
        snippet = video.get("snippet")
        content = video.get("contentDetails")
        if not isinstance(snippet, dict) or not isinstance(content, dict):
            continue
        duration_value = content.get("duration")
        if not isinstance(duration_value, str):
            continue
        duration_seconds = parse_duration(duration_value)
        published_at = snippet.get("publishedAt")
        title = snippet.get("title")
        if (
            duration_seconds is None
            or duration_seconds <= 0
            or not isinstance(published_at, str)
            or not isinstance(title, str)
            or isinstance(video.get("liveStreamingDetails"), dict)
        ):
            continue

        video_data = {
            "videoId": video_id,
            "title": title,
            "publishedAt": published_at,
            "durationSeconds": duration_seconds,
        }
        (short_videos if duration_seconds < SHORTS_MAX_SECONDS else long_videos).append(
            video_data
        )

    live_streams: list[dict[str, Any]] = []
    for video_id in live_ids:
        video = videos_by_id.get(video_id)
        if not isinstance(video, dict) or not isinstance(video.get("snippet"), dict):
            continue
        live_streams.append(
            {
                "videoId": video_id,
                "title": video["snippet"].get("title", "Live stream"),
            }
        )

    if refresh_schedule:
        upcoming_streams: list[dict[str, Any]] = []
        for video_id in upcoming_ids:
            video = videos_by_id.get(video_id)
            if not isinstance(video, dict) or not isinstance(video.get("snippet"), dict):
                continue
            live_details = video.get("liveStreamingDetails")
            start_time = (
                live_details.get("scheduledStartTime")
                if isinstance(live_details, dict)
                else None
            )
            if not isinstance(start_time, str):
                continue
            try:
                scheduled_start = datetime.fromisoformat(start_time.replace("Z", "+00:00"))
            except ValueError:
                continue
            stream = {
                "videoId": video_id,
                "title": video["snippet"].get("title", "Scheduled stream"),
                "scheduledStartTime": start_time,
            }
            if scheduled_start <= now:
                stream["scheduledStartReached"] = True
                live_streams.append(stream)
            else:
                upcoming_streams.append(stream)
    else:
        upcoming_streams = []
        for stream in existing.get("upcomingStreams", []):
            if (
                not isinstance(stream, dict)
                or not isinstance(stream.get("videoId"), str)
                or not isinstance(stream.get("title"), str)
                or not isinstance(stream.get("scheduledStartTime"), str)
            ):
                continue
            scheduled_start = datetime.fromisoformat(
                stream["scheduledStartTime"].replace("Z", "+00:00")
            )
            if scheduled_start <= now:
                live_streams.append({**stream, "scheduledStartReached": True})
            else:
                upcoming_streams.append(stream)

    output = {
        "updatedAt": now_iso,
        "scheduleUpdatedAt": now_iso if refresh_schedule else schedule_updated_at,
        "subscriberCount": subscriber_count,
        "shortVideos": short_videos[:3],
        "longVideos": long_videos[:3],
        "liveStreams": live_streams,
        "upcomingStreams": upcoming_streams,
    }
    DATA_FILE.write_text(
        json.dumps(output, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print("Updated channel data.")


if __name__ == "__main__":
    main()
