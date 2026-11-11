import { File, Paths } from 'expo-file-system';

// Where the error log lives on phones: a small JSON file in the app's documents.
// (Not the SQLite database: the log must survive a broken or wiped database.)
const file = () => new File(Paths.document, 'error-log.json');

export const errorStore = {
  async read(): Promise<string | null> {
    const f = file();
    return f.exists ? f.text() : null;
  },
  async write(text: string) {
    const f = file();
    if (!f.exists) f.create();
    await f.write(text);
  },
  async clear() {
    const f = file();
    if (f.exists) f.delete();
  },
};
