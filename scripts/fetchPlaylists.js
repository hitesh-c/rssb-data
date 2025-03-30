import fs from 'fs';
import path from 'path';
import https from 'https';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

// Setup for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Config
const API_KEY = process.env.YOUTUBE_API_KEY;
const CHANNEL_ID = process.env.CHANNEL_ID;
const OVERVIEW_PATH = path.join(__dirname, '../data/overview.json');
const VIDEOS_DIR = path.join(__dirname, '../data/videos');
const ETAG_PATH = path.join(__dirname, '../data/etags.json');

// Load cached ETags
let etagStore = {};
if (fs.existsSync(ETAG_PATH)) {
  etagStore = JSON.parse(fs.readFileSync(ETAG_PATH, 'utf-8'));
}

// Fetch JSON with optional ETag
const fetchJsonWithETag = (url, previousEtag = null) =>
  new Promise((resolve, reject) => {
    const options = { headers: {} };
    if (previousEtag) {
      options.headers['If-None-Match'] = previousEtag;
    }

    const req = https.get(url, options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        if (res.statusCode === 304) {
          resolve({ notModified: true, etag: previousEtag });
        } else {
          try {
            const json = JSON.parse(data);
            resolve({ data: json, etag: res.headers.etag });
          } catch (err) {
            reject(err);
          }
        }
      });
    });

    req.on('error', reject);
  });

// Paginated fetch with ETag caching
const fetchAllPagesWithETag = async (key, urlBuilder) => {
  const allItems = [];
  let nextPageToken = '';
  let firstEtag = null;
  let notModified = true;

  do {
    const url = urlBuilder(nextPageToken);
    const { data, etag, notModified: pageNotModified } = await fetchJsonWithETag(
      url,
      etagStore[`${key}_${nextPageToken || 'first'}`]
    );

    if (pageNotModified) {
      nextPageToken = null;
      continue;
    }

    if (!firstEtag) firstEtag = etag;
    notModified = false;
    etagStore[`${key}_${nextPageToken || 'first'}`] = etag;
    allItems.push(...(data.items || []));
    nextPageToken = data.nextPageToken || null;
  } while (nextPageToken);

  return { items: allItems, notModified, etag: firstEtag };
};

// Fetch playlists
const fetchAllPlaylists = () => {
  return fetchAllPagesWithETag('playlists', (token) =>
    `https://www.googleapis.com/youtube/v3/playlists?part=snippet&channelId=${CHANNEL_ID}&maxResults=50&pageToken=${token}&key=${API_KEY}`
  );
};

// Fetch videos for a playlist
const fetchVideosForPlaylist = (playlistId) => {
  return fetchAllPagesWithETag(`playlist_${playlistId}`, (token) =>
    `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&playlistId=${playlistId}&maxResults=50&pageToken=${token}&key=${API_KEY}`
  );
};

const run = async () => {
  console.log('🔄 Fetching playlists...');
  const { items: playlistsRaw, notModified: playlistsUnchanged } = await fetchAllPlaylists();

  if (playlistsUnchanged) {
    console.log('✅ No changes to playlists. Skipping update.');
    return;
  }

  const overview = [];
  fs.mkdirSync(VIDEOS_DIR, { recursive: true });

  for (const pl of playlistsRaw) {
    const playlistId = pl.id;
    const plMeta = {
      id: playlistId,
      title: pl.snippet.title,
      description: pl.snippet.description,
      publishedAt: pl.snippet.publishedAt,
      thumbnails: pl.snippet.thumbnails,
    };

    console.log(`▶ Fetching videos in playlist: ${plMeta.title}`);
    const { items: videosRaw } = await fetchVideosForPlaylist(playlistId);

    const videos = videosRaw.map((v) => {
      const s = v.snippet;
      return {
        videoId: s.resourceId?.videoId,
        title: s.title,
        position: s.position,
        publishedAt: s.publishedAt,
        thumbnail: s.thumbnails?.default?.url || '',
        embedUrl: `https://www.youtube.com/embed/${s.resourceId?.videoId}`,
      };
    });

    // Write to videos/<playlist_id>.json
    const playlistVideoPath = path.join(VIDEOS_DIR, `${playlistId}.json`);
    fs.writeFileSync(playlistVideoPath, JSON.stringify({
      last_updated: new Date().toISOString(),
      playlist_id: playlistId,
      total_videos: videos.length,
      videos,
    }, null, 2));

    // Append itemCount to overview entry
    overview.push({
      ...plMeta,
      itemCount: videos.length,
    });
  }

  // Write overview.json
  fs.writeFileSync(OVERVIEW_PATH, JSON.stringify({
    last_updated: new Date().toISOString(),
    channel_id: CHANNEL_ID,
    total_playlists: overview.length,
    playlists: overview,
  }, null, 2));

  // Write updated etags
  fs.writeFileSync(ETAG_PATH, JSON.stringify(etagStore, null, 2));

  console.log(`✅ Done. Saved overview and ${overview.length} playlists.`);
};

run().catch((err) => {
  console.error('❌ Script failed:', err);
  process.exit(1);
});
