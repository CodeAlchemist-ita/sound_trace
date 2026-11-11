import { getRecommendations } from './friends';
import { getUnseen, refreshUnseen, setUnseen, spotifyTrackUrl } from './recommend';

// friends.ts pulls in the database and the network: not needed here.
jest.mock('./friends', () => ({ getRecommendations: jest.fn() }));
const mockedGet = getRecommendations as jest.Mock;

describe('spotifyTrackUrl', () => {
  it('opens the song when the uri has its id', () => {
    expect(spotifyTrackUrl('spotify:track:4uLU6hMCjMI75M1A2tKUQC', 'Never Gonna Give You Up', 'Rick Astley')).toBe(
      'https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC',
    );
  });

  it('searches by title and artist without a uri', () => {
    expect(spotifyTrackUrl(null, 'Yellow', 'Coldplay')).toBe('https://open.spotify.com/search/Yellow%20Coldplay');
  });

  it('searches when the uri is not a track uri', () => {
    expect(spotifyTrackUrl('spotify:episode:abc', 'Yellow', 'Coldplay')).toBe('https://open.spotify.com/search/Yellow%20Coldplay');
    expect(spotifyTrackUrl('spotify:track:', 'Yellow', 'Coldplay')).toBe('https://open.spotify.com/search/Yellow%20Coldplay');
    expect(spotifyTrackUrl('spotify:track:a/b', 'Yellow', 'Coldplay')).toBe('https://open.spotify.com/search/Yellow%20Coldplay');
  });

  it('escapes special characters in the search', () => {
    expect(spotifyTrackUrl(null, 'Guns & Roses?', 'AC/DC #1')).toBe(
      `https://open.spotify.com/search/${encodeURIComponent('Guns & Roses? AC/DC #1')}`,
    );
  });
});

describe('unseen count', () => {
  afterEach(() => setUnseen(0));

  it('stores the count', () => {
    setUnseen(3);
    expect(getUnseen()).toBe(3);
  });

  it('never goes negative or fractional', () => {
    setUnseen(-2);
    expect(getUnseen()).toBe(0);
    setUnseen(2.6);
    expect(getUnseen()).toBe(3);
  });

  it('refreshUnseen stores the count from the server', async () => {
    mockedGet.mockResolvedValueOnce({ received: [], sent: [], unseen: 4 });
    await refreshUnseen();
    expect(getUnseen()).toBe(4);
  });

  it('refreshUnseen keeps the last count when the server fails', async () => {
    setUnseen(2);
    mockedGet.mockRejectedValueOnce(new Error('offline'));
    await expect(refreshUnseen()).resolves.toBeUndefined();
    expect(getUnseen()).toBe(2);
  });
});
