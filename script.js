const CHANNEL_URL = "https://www.youtube.com/channel/UCMxGPWLjDHRQ9xoLHCXd45g";
const STREAMS_URL = `${CHANNEL_URL}/streams`;
const DATA_URL = new URL("channel-data.json", document.currentScript.src);
const SHORTS_MAX_SECONDS = 120;
const DATA_REFRESH_INTERVAL = 15 * 60 * 1000;

const menuToggle = document.querySelector(".site-nav-toggle");
const navigation = document.querySelector("#site-nav-links");
const subscriberLink = document.querySelector(".site-subscriber-count");
const subscriberCount = document.querySelector("#subscriber-count");
const shortVideos = document.querySelector("#short-videos");
const longVideos = document.querySelector("#long-videos");
const homeSchedule = document.querySelector("#home-upcoming-streams");
const liveSchedule = document.querySelector("#live-upcoming-streams");
const liveStatusTitle = document.querySelector("#live-status-title");
const liveStatusMessage = document.querySelector("#live-status-message");
const liveStatusWrap = document.querySelector("#status-wrap");
const liveWatchLink = document.querySelector("#live-watch-link");
const livePlayerContainer = document.querySelector("#live-player-container");
const channelDataStatus = document.querySelector("#channel-data-status");
const currentYear = document.querySelector("#current-year");

let streamTransitionTimeout;

if (currentYear) {
  currentYear.textContent = new Date().getFullYear();
}

if (menuToggle && navigation) {
  const setMenuOpen = (open) => {
    const expanded = window.matchMedia("(max-width: 767px)").matches && open;
    navigation.hidden = !window.matchMedia("(min-width: 768px)").matches && !open;
    menuToggle.setAttribute("aria-expanded", String(expanded));
    menuToggle.setAttribute(
      "aria-label",
      expanded ? "Close navigation menu" : "Open navigation menu",
    );
  };

  setMenuOpen(window.matchMedia("(min-width: 768px)").matches);

  menuToggle.addEventListener("click", () => {
    setMenuOpen(menuToggle.getAttribute("aria-expanded") !== "true");
  });

  navigation.addEventListener("click", (event) => {
    if (
      event.target instanceof Element
      && event.target.closest("a")
      && window.matchMedia("(max-width: 767px)").matches
    ) {
      setMenuOpen(false);
    }
  });

  document.addEventListener("keydown", (event) => {
    if (
      event.key === "Escape"
      && menuToggle.getAttribute("aria-expanded") === "true"
    ) {
      setMenuOpen(false);
      menuToggle.focus();
    }
  });

  window.addEventListener("resize", () => {
    if (window.matchMedia("(min-width: 768px)").matches) {
      setMenuOpen(false);
    }
  });
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isVideo(value) {
  return isRecord(value)
    && typeof value.videoId === "string"
    && typeof value.title === "string"
    && typeof value.publishedAt === "string"
    && typeof value.durationSeconds === "number";
}

function isStream(value, upcoming = false) {
  return isRecord(value)
    && typeof value.videoId === "string"
    && typeof value.title === "string"
    && (!upcoming
      || (
        typeof value.scheduledStartTime === "string"
        && Number.isFinite(Date.parse(value.scheduledStartTime))
      ));
}

function validateChannelData(value) {
  if (
    !isRecord(value)
    || !Array.isArray(value.shortVideos)
    || !Array.isArray(value.longVideos)
    || !Array.isArray(value.liveStreams)
    || !Array.isArray(value.upcomingStreams)
    || value.shortVideos.some((video) => !isVideo(video))
    || value.longVideos.some((video) => !isVideo(video))
    || value.liveStreams.some((stream) => !isStream(stream))
    || value.upcomingStreams.some((stream) => !isStream(stream, true))
    || (
      value.subscriberCount !== null
      && (
        typeof value.subscriberCount !== "string"
        || !/^\d+$/.test(value.subscriberCount)
      )
    )
  ) {
    throw new Error("Channel data has an invalid format.");
  }
  return value;
}

function formatDate(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    return "Date unavailable";
  }
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(date);
}

function formatDuration(totalSeconds) {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`
    : `${minutes}:${String(remainder).padStart(2, "0")}`;
}

function createMessage(text, className = "empty-message") {
  const message = document.createElement("p");
  message.className = className;
  message.textContent = text;
  return message;
}

function createVideoCard(video, label) {
  const link = document.createElement("a");
  link.className = "video-card";
  link.href = `https://www.youtube.com/watch?v=${encodeURIComponent(video.videoId)}`;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.setAttribute("aria-label", `Watch ${video.title} on YouTube`);

  const thumbnail = document.createElement("span");
  thumbnail.className = "video-thumbnail";
  const image = document.createElement("img");
  image.src = `https://i.ytimg.com/vi/${encodeURIComponent(video.videoId)}/hqdefault.jpg`;
  image.alt = "";
  image.loading = "lazy";
  image.width = 480;
  image.height = 360;
  const play = document.createElement("span");
  play.className = "video-play";
  play.setAttribute("aria-hidden", "true");
  play.textContent = "▶";
  thumbnail.append(image, play);

  const meta = document.createElement("span");
  meta.className = "video-meta";
  const category = document.createElement("span");
  category.textContent = label;
  const date = document.createElement("time");
  date.dateTime = video.publishedAt;
  date.textContent = formatDate(video.publishedAt);
  meta.append(category, date);

  const title = document.createElement("span");
  title.className = "video-title";
  title.textContent = video.title;

  const duration = document.createElement("span");
  duration.className = "video-meta";
  const durationLabel = document.createElement("span");
  durationLabel.className = "video-duration";
  durationLabel.textContent = formatDuration(video.durationSeconds);
  duration.append(durationLabel);

  link.append(thumbnail, meta, title, duration);
  return link;
}

function renderVideos(container, videos, label, unavailable = false) {
  if (!container) {
    return;
  }
  container.replaceChildren();
  if (videos.length === 0) {
    container.append(createMessage(
      unavailable
        ? "Recent videos are temporarily unavailable."
        : "No recent videos are available yet.",
    ));
    return;
  }
  container.append(createVideoCard(videos[0], label));
}

function formatStreamTime(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    return "Stream time unavailable";
  }
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "full",
    timeStyle: "short",
  }).format(date);
}

function createStreamCard(stream) {
  const card = document.createElement("article");
  card.className = "upcoming-stream-card";

  const channel = document.createElement("p");
  channel.className = "upcoming-stream-channel";
  channel.textContent = "Noah and Ed's Train Adventures Gaming";

  const title = document.createElement("h4");
  title.className = "upcoming-stream-title";
  title.textContent = stream.title;

  const time = document.createElement("p");
  time.className = "upcoming-stream-time";
  time.textContent = `Upcoming live stream - ${formatStreamTime(stream.scheduledStartTime)}`;

  const link = document.createElement("a");
  link.className = "upcoming-stream-link";
  link.href = `https://www.youtube.com/watch?v=${encodeURIComponent(stream.videoId)}`;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = "View scheduled stream";

  card.append(channel, title, time, link);
  return card;
}

function renderSchedule(container, streams, unavailable = false) {
  if (!container) {
    return;
  }
  container.replaceChildren();
  if (unavailable) {
    container.append(createMessage("Stream schedule is temporarily unavailable."));
    return;
  }

  const futureStreams = streams
    .filter((stream) => Date.parse(stream.scheduledStartTime) > Date.now())
    .sort((first, second) => (
      Date.parse(first.scheduledStartTime) - Date.parse(second.scheduledStartTime)
    ));

  if (futureStreams.length === 0) {
    container.append(createMessage("No upcoming live streams are scheduled right now."));
    return;
  }
  container.append(...futureStreams.map(createStreamCard));
}

function updateSubscriberCount(count) {
  if (!subscriberCount || !subscriberLink) {
    return;
  }
  if (count === null) {
    subscriberCount.textContent = "Unavailable";
    subscriberLink.setAttribute(
      "aria-label",
      "Subscriber count unavailable. Visit the YouTube channel.",
    );
    return;
  }

  const formattedCount = new Intl.NumberFormat().format(Number(count));
  subscriberCount.textContent = formattedCount;
  subscriberLink.setAttribute(
    "aria-label",
    `${formattedCount} subscribers. Visit the YouTube channel.`,
  );
}

function updateLiveStatus(liveStreams, upcomingStreams) {
  const now = Date.now();
  const activeStream = liveStreams[0] ?? upcomingStreams
    .filter((stream) => Date.parse(stream.scheduledStartTime) <= now)
    .sort((first, second) => (
      Date.parse(first.scheduledStartTime) - Date.parse(second.scheduledStartTime)
    ))[0];
  const isLive = Boolean(activeStream && !activeStream.scheduledStartReached);
  document.querySelector("#live-nav-link")?.classList.toggle("is-live", isLive);

  if (!liveStatusTitle || !liveStatusMessage || !liveStatusWrap || !liveWatchLink) {
    return;
  }

  liveStatusWrap.classList.toggle("is-live", isLive);
  if (!activeStream) {
    liveStatusTitle.textContent = "No live stream right now";
    liveStatusMessage.textContent = "There is no active broadcast. Check back for future streams.";
    liveWatchLink.href = STREAMS_URL;
    liveWatchLink.textContent = "Open YouTube streams ↗";
    livePlayerContainer?.replaceChildren();
    if (livePlayerContainer) {
      livePlayerContainer.hidden = true;
    }
    return;
  }

  const starting = !isLive;
  liveStatusTitle.textContent = isLive ? "Live now" : "Scheduled stream starting";
  liveStatusMessage.textContent = isLive
    ? activeStream.title
    : `${activeStream.title} — scheduled for ${formatStreamTime(activeStream.scheduledStartTime)}.`;
  liveWatchLink.href = `https://www.youtube.com/watch?v=${encodeURIComponent(activeStream.videoId)}`;
  liveWatchLink.textContent = isLive ? "Watch live stream ↗" : "Open scheduled stream ↗";
  liveWatchLink.classList.toggle("button-primary", isLive);
  liveWatchLink.classList.toggle("button-secondary", !isLive);

  if (livePlayerContainer) {
    const existingPlayer = livePlayerContainer.querySelector("iframe");
    if (existingPlayer?.dataset.videoId !== activeStream.videoId) {
      const player = document.createElement("iframe");
      player.dataset.videoId = activeStream.videoId;
      player.src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(activeStream.videoId)}?rel=0`;
      player.title = isLive ? `Live stream: ${activeStream.title}` : `Scheduled stream: ${activeStream.title}`;
      player.loading = "lazy";
      player.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture";
      player.allowFullscreen = true;
      livePlayerContainer.replaceChildren(player);
    }
    livePlayerContainer.hidden = false;
  }
  if (starting) {
    liveStatusWrap.classList.remove("is-live");
  }
}

function setDataUnavailable() {
  updateSubscriberCount(null);
  renderVideos(shortVideos, [], "Short-form", true);
  renderVideos(longVideos, [], "Long-form", true);
  renderSchedule(homeSchedule, [], true);
  renderSchedule(liveSchedule, [], true);
  if (liveStatusTitle) {
    liveStatusTitle.textContent = "Live status unavailable";
  }
  if (liveStatusMessage) {
    liveStatusMessage.textContent = "Channel data could not be loaded. Please try again later.";
  }
  if (liveWatchLink) {
    liveWatchLink.href = STREAMS_URL;
  }
  if (livePlayerContainer) {
    livePlayerContainer.replaceChildren();
    livePlayerContainer.hidden = true;
  }
  liveStatusWrap?.classList.remove("is-live");
  document.querySelector("#live-nav-link")?.classList.remove("is-live");
  if (channelDataStatus) {
    channelDataStatus.textContent = "Channel data could not be loaded.";
  }
}

function scheduleStreamRefresh(streams) {
  window.clearTimeout(streamTransitionTimeout);
  const nextStart = streams
    .map((stream) => Date.parse(stream.scheduledStartTime))
    .filter((time) => time > Date.now())
    .sort((first, second) => first - second)[0];
  if (nextStart === undefined) {
    return;
  }
  streamTransitionTimeout = window.setTimeout(
    loadChannelData,
    Math.min(nextStart - Date.now() + 1000, 2_147_483_647),
  );
}

async function loadChannelData() {
  try {
    const url = new URL(DATA_URL);
    url.searchParams.set("v", Date.now().toString());
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Channel data request failed: ${response.status}`);
    }

    const data = validateChannelData(await response.json());
    updateSubscriberCount(data.subscriberCount);
    renderVideos(shortVideos, data.shortVideos, "Short-form");
    renderVideos(longVideos, data.longVideos, "Long-form");
    renderSchedule(homeSchedule, data.upcomingStreams);
    renderSchedule(liveSchedule, data.upcomingStreams);
    updateLiveStatus(data.liveStreams, data.upcomingStreams);
    scheduleStreamRefresh(data.upcomingStreams);

    if (channelDataStatus) {
      const updatedAt = data.updatedAt ? formatDate(data.updatedAt) : null;
      channelDataStatus.textContent = updatedAt
        ? `Channel data last updated ${updatedAt}.`
        : "Channel data will appear after the first successful scheduled update.";
    }
  } catch (error) {
    console.error("Could not load gaming channel data:", error);
    setDataUnavailable();
  }
}

loadChannelData();
window.setInterval(loadChannelData, DATA_REFRESH_INTERVAL);
