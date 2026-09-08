import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { prodApi } from "@/lib/api";
import { fetchAlbum, fetchAlbums } from "@/lib/mock-api";
import type { AlbumRecord, PageRecord } from "@/contracts";

export const qk = {
  albums: ["albums"] as const,
  album: (id: string) => ["album", id] as const,
};

type UiAlbum = AlbumRecord & { pages?: PageRecord[]; coverUrl?: string; publicId?: string };

function toUiAlbum(a: AlbumRecord & { pages?: PageRecord[] }): UiAlbum {
  return a;
}

/** Album list: production API when configured, mock fallback locally. */
export function useAlbums() {
  return useQuery({
    queryKey: qk.albums,
    queryFn: async (): Promise<UiAlbum[]> => {
      if (prodApi.configured) {
        const rows = await prodApi.listAlbums();
        return rows.map(toUiAlbum);
      }
      const mock = await fetchAlbums();
      return mock as unknown as UiAlbum[];
    },
    staleTime: 15_000,
  });
}

export function useAlbum(id: string) {
  return useQuery({
    queryKey: qk.album(id),
    queryFn: async (): Promise<UiAlbum | null> => {
      if (prodApi.configured) {
        try {
          return await prodApi.getAlbum(id);
        } catch (e) {
          const code = (e as { code?: string })?.code;
          if (code === "NOT_FOUND") return null;
          throw e;
        }
      }
      return (await fetchAlbum(id)) as unknown as UiAlbum | null;
    },
    enabled: !!id,
    staleTime: 10_000,
  });
}

export function useCreateAlbum() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      coupleName: string;
      eventDate?: string;
      venue?: string;
      expiryDate?: string;
    }) => prodApi.createAlbum(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.albums }),
  });
}

export function usePublishAlbum(albumId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => prodApi.publish(albumId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.album(albumId) });
      qc.invalidateQueries({ queryKey: qk.albums });
    },
  });
}

export function useDeleteAlbum() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (albumId: string) => prodApi.deleteAlbum(albumId),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.albums }),
  });
}
