import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

/** Phones: writes the text to a temporary file and opens the system share sheet. */
export async function shareText(filename: string, text: string, dialogTitle: string) {
  const file = new File(Paths.cache, filename);
  if (!file.exists) file.create();
  await file.write(text);
  await Sharing.shareAsync(file.uri, { mimeType: 'text/plain', dialogTitle });
}
