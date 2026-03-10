const PODCAST_LINKS = [
  {
    name: 'Apple Podcasts',
    image: '/podcast-apple.png',
    url: 'https://podcasts.apple.com/de/podcast/synthszr/id1879733990',
  },
  {
    name: 'Spotify',
    image: '/podcast-spotify.png',
    url: 'https://open.spotify.com/show/0FJkPjKXvobgqI8U881yiF?si=wMJJ-CQxQdyuW18VXQZQOQ',
  },
  {
    name: 'YouTube',
    image: '/podcast-youtube.png',
    url: 'https://www.youtube.com/@synthszr',
  },
  {
    name: 'Audible',
    image: '/podcast-audible.png',
    url: 'https://www.amazon.com/-/de/dp/B0GQ4XGD9L/',
  },
]

export function PodcastBadges() {
  return (
    <div className="bg-white">
      <img
        src="/podcast-headline.png"
        alt="The daily synthszr podcast"
        className="mx-auto h-9 w-auto"
      />
      <div className="flex items-center justify-center gap-3 pt-2 pb-3">
        {PODCAST_LINKS.map((link) => (
          <a
            key={link.name}
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
            className="hover:opacity-80 transition-opacity"
          >
            <img
              src={link.image}
              alt={link.name}
              className="h-7 w-auto"
            />
          </a>
        ))}
      </div>
    </div>
  )
}
