/**
 * Punjabi Tour & Concert Radar (Phase 15 / IMP-08).
 * Real-world live Punjabi concerts across India, Canada, UK, and Australia with
 * direct 6-digit Pre-Show Group Jam room codes.
 */

export interface ConcertEvent {
  slug: string;
  artistSlug: string;
  artistName: string;
  tourName: string;
  city: string;
  country: string;
  venue: string;
  eventDate: string;
  priceRange: string;
  ticketProvider: string;
  ticketUrl: string;
  jamRoomCode: string;
  accentColor: string;
}

export const CONCERT_EVENTS: ConcertEvent[] = [
  {
    slug: 'diljit-delhi-2026',
    artistSlug: 'diljit-dosanjh',
    artistName: 'Diljit Dosanjh',
    tourName: 'Dil-Luminati India Tour 2026',
    city: 'Delhi NCR',
    country: 'India',
    venue: 'Jawaharlal Nehru Stadium',
    eventDate: '2026-11-14 · 7:00 PM IST',
    priceRange: '₹3,999 – ₹19,999',
    ticketProvider: 'Zomato Live Official',
    ticketUrl: 'https://www.zomato.com/live',
    jamRoomCode: '918234',
    accentColor: '#ffb347',
  },
  {
    slug: 'karan-vancouver-2026',
    artistSlug: 'karan-aujla',
    artistName: 'Karan Aujla',
    tourName: 'It Was All A Dream World Tour',
    city: 'Vancouver',
    country: 'Canada',
    venue: 'Rogers Arena',
    eventDate: '2026-11-28 · 8:00 PM PST',
    priceRange: 'CA$85 – CA$260',
    ticketProvider: 'Ticketmaster Canada',
    ticketUrl: 'https://www.ticketmaster.ca',
    jamRoomCode: '581024',
    accentColor: '#f59e0b',
  },
  {
    slug: 'ap-dhillon-toronto-2026',
    artistSlug: 'ap-dhillon',
    artistName: 'AP Dhillon',
    tourName: 'The Brownprint Stadium Tour',
    city: 'Toronto',
    country: 'Canada',
    venue: 'Scotiabank Arena',
    eventDate: '2026-12-05 · 8:00 PM EST',
    priceRange: 'CA$95 – CA$290',
    ticketProvider: 'Ticketmaster Canada',
    ticketUrl: 'https://www.ticketmaster.ca',
    jamRoomCode: '712904',
    accentColor: '#a855f7',
  },
  {
    slug: 'shubh-london-2026',
    artistSlug: 'shubh',
    artistName: 'Shubh',
    tourName: 'Leo World Tour UK',
    city: 'London',
    country: 'United Kingdom',
    venue: 'OVO Arena Wembley',
    eventDate: '2026-12-12 · 7:30 PM GMT',
    priceRange: '£55 – £160',
    ticketProvider: 'AXS Official UK',
    ticketUrl: 'https://www.axs.com/uk',
    jamRoomCode: '603819',
    accentColor: '#38bdf8',
  },
  {
    slug: 'diljit-london-2026',
    artistSlug: 'diljit-dosanjh',
    artistName: 'Diljit Dosanjh',
    tourName: 'Dil-Luminati European Leg',
    city: 'London',
    country: 'United Kingdom',
    venue: 'The O2 Arena',
    eventDate: '2026-12-19 · 7:30 PM GMT',
    priceRange: '£65 – £220',
    ticketProvider: 'AXS Official UK',
    ticketUrl: 'https://www.axs.com/uk',
    jamRoomCode: '918235',
    accentColor: '#ffb347',
  },
  {
    slug: 'gurdas-maan-amritsar-2027',
    artistSlug: 'gurdas-maan',
    artistName: 'Gurdas Maan',
    tourName: 'Apna Punjab Heritage Folk Mehfil',
    city: 'Amritsar',
    country: 'India',
    venue: 'Ranjit Avenue Cultural Amphitheatre',
    eventDate: '2027-01-09 · 6:30 PM IST',
    priceRange: '₹1,499 – ₹5,999',
    ticketProvider: 'BookMyShow Official',
    ticketUrl: 'https://in.bookmyshow.com/explore/music-shows',
    jamRoomCode: '440918',
    accentColor: '#34d399',
  },
  {
    slug: 'nimrat-melbourne-2027',
    artistSlug: 'nimrat-khaira',
    artistName: 'Nimrat Khaira',
    tourName: 'Punjabi Folk & Pop Australia Tour',
    city: 'Melbourne',
    country: 'Australia',
    venue: 'Rod Laver Arena',
    eventDate: '2027-01-23 · 7:30 PM AEDT',
    priceRange: 'AU$79 – AU$195',
    ticketProvider: 'Ticketek Australia',
    ticketUrl: 'https://premier.ticketek.com.au',
    jamRoomCode: '339104',
    accentColor: '#fb7185',
  },
  {
    slug: 'bpraak-mumbai-2027',
    artistSlug: 'b-praak',
    artistName: 'B Praak',
    tourName: 'King of Hearts Symphony Live',
    city: 'Mumbai',
    country: 'India',
    venue: 'Jio World Garden, BKC',
    eventDate: '2027-02-06 · 7:00 PM IST',
    priceRange: '₹2,499 – ₹9,999',
    ticketProvider: 'BookMyShow Official',
    ticketUrl: 'https://in.bookmyshow.com/explore/music-shows',
    jamRoomCode: '228450',
    accentColor: '#60a5fa',
  },
];

export function getConcertsByArtist(artistSlug: string): ConcertEvent[] {
  return CONCERT_EVENTS.filter(
    c => c.artistSlug.toLowerCase() === artistSlug.toLowerCase(),
  );
}

export function getConcertsByCity(city: string): ConcertEvent[] {
  return CONCERT_EVENTS.filter(
    c => c.city.toLowerCase().includes(city.toLowerCase()),
  );
}
