#!/usr/bin/env node
/**
 * Migrate authors from Astro content collection (datum.net) to Strapi Cloud
 *
 * Usage:
 *   STRAPI_URL=https://your-project.strapiapp.com STRAPI_API_TOKEN=xxx node scripts/migrate-authors-to-strapi.js
 *
 * Env vars:
 *   STRAPI_URL       - Strapi API base URL (required)
 *   STRAPI_API_TOKEN - API token with create permission for authors & upload (required)
 *   AUTHORS_SOURCE   - Path to datum.net/src/content/authors (default: ../../datum.net/src/content/authors)
 */

const fs = require('fs');
const path = require('path');
const matter = require('gray-matter');

const STRAPI_URL = process.env.STRAPI_URL?.replace(/\/$/, '');
const STRAPI_API_TOKEN = process.env.STRAPI_API_TOKEN;
const AUTHORS_SOURCE =
  process.env.AUTHORS_SOURCE ||
  path.join(__dirname, '../../datum.net/src/content/authors');

if (!STRAPI_URL || !STRAPI_API_TOKEN) {
  console.error('Missing required env vars: STRAPI_URL, STRAPI_API_TOKEN');
  process.exit(1);
}

function parseFrontmatter(content) {
  const parsed = matter(content);
  return parsed.data;
}

function getAuthorFiles(dir) {
  const files = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory() && !entry.name.startsWith('.')) {
      files.push(...getAuthorFiles(fullPath));
    } else if (entry.isFile() && /\.(md|mdx)$/.test(entry.name) && !entry.name.startsWith('_')) {
      files.push(fullPath);
    }
  }
  return files;
}

function loadAuthors(sourceDir) {
  const authors = [];
  const files = getAuthorFiles(sourceDir);
  for (const filePath of files) {
    const content = fs.readFileSync(filePath, 'utf-8');
    const data = parseFrontmatter(content);
    if (!data || !data.name) continue;
    const slug = path.basename(filePath, path.extname(filePath));
    const dir = path.dirname(filePath);
    let avatarPath = null;
    if (data.avatar) {
      avatarPath = path.isAbsolute(data.avatar)
        ? data.avatar
        : path.join(dir, data.avatar);
      if (!fs.existsSync(avatarPath)) avatarPath = null;
    }
    authors.push({
      slug,
      name: data.name,
      title: data.title,
      bio: data.bio || '',
      avatarPath,
      isTeam: data.isTeam === true || data.isTeam === 'true',
      team: data.team === 'founders' || data.team === 'team' ? data.team : null,
      social: data.social
        ? typeof data.social === 'string'
          ? JSON.parse(data.social)
          : data.social
        : null,
      tick: data.tick,
      surprising: data.surprising,
      weekends: data.weekends,
    });
  }
  return authors;
}

async function uploadFile(filePath, name) {
  const FormData = require('form-data');
  const form = new FormData();
  form.append('files', fs.createReadStream(filePath), {
    filename: path.basename(filePath),
  });
  form.append(
    'fileInfo',
    JSON.stringify({
      name: name || path.basename(filePath, path.extname(filePath)),
      alternativeText: name || path.basename(filePath),
    })
  );
  const res = await fetch(`${STRAPI_URL}/api/upload`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${STRAPI_API_TOKEN}`,
      ...form.getHeaders(),
    },
    body: form,
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Upload failed: ${res.status} ${err}`);
  }
  const json = await res.json();
  const files = Array.isArray(json) ? json : json?.files || [json];
  const file = files[0];
  return file?.id ?? file?.documentId ?? file;
}

async function createAuthor(author, avatarId) {
  const payload = {
    data: {
      name: author.name,
      bio: author.bio,
      title: author.title ?? undefined,
      isTeam: author.isTeam,
      team: author.team ?? undefined,
      tick: author.tick ?? undefined,
      surprising: author.surprising ?? undefined,
      weekends: author.weekends ?? undefined,
      avatar: avatarId ?? undefined,
      social:
        author.social &&
        (author.social.twitter || author.social.github || author.social.linkedin)
          ? author.social
          : undefined,
    },
  };
  const res = await fetch(`${STRAPI_URL}/api/authors`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${STRAPI_API_TOKEN}`,
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Create author failed: ${res.status} ${err}`);
  }
  return res.json();
}

async function main() {
  if (!fs.existsSync(AUTHORS_SOURCE)) {
    console.error(`Authors source not found: ${AUTHORS_SOURCE}`);
    process.exit(1);
  }

  const authors = loadAuthors(AUTHORS_SOURCE);
  console.log(`Found ${authors.length} authors to migrate`);

  for (const author of authors) {
    try {
      let avatarId = null;
      if (author.avatarPath) {
        avatarId = await uploadFile(author.avatarPath, author.name);
        console.log(`  Uploaded avatar for ${author.name}`);
      }
      const result = await createAuthor(author, avatarId);
      const docId = result?.data?.documentId ?? result?.documentId ?? result?.data?.id;
      console.log(`  Created: ${author.name} (${docId})`);
    } catch (err) {
      console.error(`  Failed ${author.name}:`, err.message);
    }
  }

  console.log('Migration complete');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
