#!/usr/bin/env node
/**
 * Sync authors and categories from datum.net content collection to data.json
 * Copies avatar images to data/uploads/ and updates data.json
 *
 * Usage: node scripts/sync-authors-to-data.js
 * Env: AUTHORS_SOURCE - path to datum.net/src/content/authors
 *      CATEGORIES_SOURCE - path to datum.net/src/content/categories
 */

const fs = require('fs');
const path = require('path');
const matter = require('gray-matter');

const AUTHORS_SOURCE =
  process.env.AUTHORS_SOURCE ||
  path.join(__dirname, '../../datum.net/src/content/authors');
const CATEGORIES_SOURCE =
  process.env.CATEGORIES_SOURCE ||
  path.join(__dirname, '../../datum.net/src/content/categories');
const DATA_JSON = path.join(__dirname, '../data/data.json');
const UPLOADS_DIR = path.join(__dirname, '../data/uploads');

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
    const data = matter(content).data;
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
      position: data.position,
      social: data.social
        ? typeof data.social === 'string'
          ? JSON.parse(data.social)
          : data.social
        : null,
      tick: data.tick,
      surprising: data.surprising,
      weekends: data.weekends,
      bgColor: data.bgColor,
    });
  }
  return authors;
}

function toDataJsonFormat(author, avatarFilename) {
  const entry = {
    name: author.name,
    bio: author.bio,
    isTeam: author.isTeam,
  };
  if (author.title) entry.title = author.title;
  if (author.team) entry.team = author.team;
  if (author.position) entry.position = author.position;
  if (author.tick) entry.tick = author.tick;
  if (author.surprising) entry.surprising = author.surprising;
  if (author.weekends) entry.weekends = author.weekends;
  if (author.bgColor) entry.bgColor = author.bgColor;
  if (avatarFilename) entry.avatar = avatarFilename;
  if (
    author.social &&
    (author.social.twitter || author.social.github || author.social.linkedin)
  ) {
    entry.social = author.social;
  }
  return entry;
}

function getCategoryFiles(dir) {
  const files = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory() && !entry.name.startsWith('.')) {
      files.push(...getCategoryFiles(fullPath));
    } else if (entry.isFile() && /\.(md|mdx)$/.test(entry.name) && !entry.name.startsWith('_')) {
      files.push(fullPath);
    }
  }
  return files;
}

function loadCategories(sourceDir) {
  const categories = [];
  const files = getCategoryFiles(sourceDir);
  for (const filePath of files) {
    const content = fs.readFileSync(filePath, 'utf-8');
    const data = matter(content).data;
    if (!data || !data.name) continue;
    const slug = data.slug || path.basename(filePath, path.extname(filePath));
    const dir = path.dirname(filePath);
    let featuredImagePath = null;
    if (data.featuredImage) {
      featuredImagePath = path.isAbsolute(data.featuredImage)
        ? data.featuredImage
        : path.join(dir, data.featuredImage);
      if (!fs.existsSync(featuredImagePath)) featuredImagePath = null;
    }
    categories.push({
      name: data.name,
      slug,
      subtitle: data.subtitle || undefined,
      description: data.description || undefined,
      featuredImagePath,
    });
  }
  return categories;
}

function toCategoryDataJsonFormat(category, featuredImageFilename) {
  const entry = { name: category.name, slug: category.slug };
  if (category.subtitle) entry.subtitle = category.subtitle;
  if (category.description) entry.description = category.description;
  if (featuredImageFilename) entry.featuredImage = featuredImageFilename;
  return entry;
}

function main() {
  const data = JSON.parse(fs.readFileSync(DATA_JSON, 'utf-8'));

  // Sync categories
  if (fs.existsSync(CATEGORIES_SOURCE)) {
    const categories = loadCategories(CATEGORIES_SOURCE);
    const dataJsonCategories = [];
    for (const category of categories) {
      let featuredImageFilename = null;
      if (category.featuredImagePath) {
        const ext = path.extname(category.featuredImagePath);
        featuredImageFilename = `${category.slug}${ext}`;
        const destPath = path.join(UPLOADS_DIR, featuredImageFilename);
        fs.copyFileSync(category.featuredImagePath, destPath);
        console.log(`  Copied category image: ${featuredImageFilename}`);
      }
      dataJsonCategories.push(toCategoryDataJsonFormat(category, featuredImageFilename));
    }
    data.categories = dataJsonCategories;
    console.log(`Synced ${categories.length} categories`);
  } else {
    console.warn(`Categories source not found: ${CATEGORIES_SOURCE}`);
  }

  // Sync authors
  if (!fs.existsSync(AUTHORS_SOURCE)) {
    console.error(`Authors source not found: ${AUTHORS_SOURCE}`);
    process.exit(1);
  }

  const authors = loadAuthors(AUTHORS_SOURCE);
  console.log(`Found ${authors.length} authors`);

  if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  }

  const dataJsonAuthors = [];
  for (const author of authors) {
    let avatarFilename = null;
    if (author.avatarPath) {
      const ext = path.extname(author.avatarPath);
      avatarFilename = `${author.slug}${ext}`;
      const destPath = path.join(UPLOADS_DIR, avatarFilename);
      fs.copyFileSync(author.avatarPath, destPath);
      console.log(`  Copied avatar: ${avatarFilename}`);
    } else {
      avatarFilename = 'default-image.png';
      if (fs.existsSync(path.join(UPLOADS_DIR, avatarFilename))) {
        console.log(`  Using default avatar for ${author.name}`);
      }
    }
    dataJsonAuthors.push(toDataJsonFormat(author, avatarFilename));
  }

  data.authors = dataJsonAuthors;
  fs.writeFileSync(DATA_JSON, JSON.stringify(data, null, 2));
  console.log(`Updated data.json with ${dataJsonAuthors.length} authors`);
}

main();
