export type SavedResultImage = { id: string; image: Blob; hasStory: boolean; savedAt: number; version: 1 };
export const RESULT_IMAGE_SAVED = "humansonly-result-image-saved";

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("humansonly-result-images", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("images", { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("Image storage unavailable"));
  });
}
export async function loadResultImage(id: string): Promise<SavedResultImage | null> {
  try {
    const db = await openDatabase();
    try {
      return await new Promise((resolve, reject) => {
        const request = db.transaction("images", "readonly").objectStore("images").get(id);
        request.onsuccess = () => {
          const row = request.result as SavedResultImage | undefined;
          resolve(row?.version === 1 && row.image instanceof Blob && row.image.type === "image/png" ? row : null);
        };
        request.onerror = () => reject(request.error);
      });
    } finally { db.close(); }
  } catch { return null; }
}
export async function saveResultImage(row: SavedResultImage): Promise<SavedResultImage> {
  try {
    const db = await openDatabase();
    try {
      const saved = await new Promise<SavedResultImage>((resolve, reject) => {
        const transaction = db.transaction("images", "readwrite"), store = transaction.objectStore("images");
        let chosen = row;
        const current = store.get(row.id);
        current.onsuccess = () => {
          const previous = current.result as SavedResultImage | undefined;
          if (previous?.version === 1 && previous.hasStory && !row.hasStory) chosen = previous;
          else store.put(row);
          const all = store.getAll();
          all.onsuccess = () => {
            const rows = all.result as SavedResultImage[];
            rows.sort((a, b) => b.savedAt - a.savedAt).slice(50).forEach(item => store.delete(item.id));
          };
        };
        transaction.oncomplete = () => resolve(chosen);
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
      });
      window.dispatchEvent(new CustomEvent(RESULT_IMAGE_SAVED, { detail: row.id }));
      return saved;
    } finally { db.close(); }
  } catch { return row; }
}
