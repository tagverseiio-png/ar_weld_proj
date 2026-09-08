import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useCreateAlbum, useUpdateAlbum } from "@/hooks/useAlbums";
import { prodApi } from "@/lib/api";

export type AlbumFormValues = {
  coupleName: string;
  eventDate?: string;
  venue?: string;
  expiryDate?: string;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Set for edit mode; omit for create mode. */
  albumId?: string | undefined;
  initial?: Partial<AlbumFormValues>;
  onCreated?: (albumId: string) => void;
};

/** Create + edit dialog for albums (full CRUD: C + U). */
export function AlbumDialog({ open, onOpenChange, albumId, initial, onCreated }: Props) {
  const isEdit = !!albumId;
  const create = useCreateAlbum();
  const update = useUpdateAlbum(albumId ?? "");
  const [coupleName, setCoupleName] = useState(initial?.coupleName ?? "");
  const [eventDate, setEventDate] = useState(initial?.eventDate ?? "");
  const [venue, setVenue] = useState(initial?.venue ?? "");
  const [expiryDate, setExpiryDate] = useState(initial?.expiryDate ?? "");
  const [error, setError] = useState<string | null>(null);

  // Reset fields whenever the dialog opens for a (possibly different) album.
  useEffect(() => {
    if (open) {
      setCoupleName(initial?.coupleName ?? "");
      setEventDate(initial?.eventDate ?? "");
      setVenue(initial?.venue ?? "");
      setExpiryDate(initial?.expiryDate ?? "");
      setError(null);
      create.reset();
      update.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, albumId]);

  const pending = create.isPending || update.isPending;

  async function save() {
    setError(null);
    const name = coupleName.trim();
    if (!name) {
      setError("Couple name is required.");
      return;
    }
    if (!prodApi.configured) {
      toast.message("Prototype mode — albums are mocked locally.");
      return;
    }
    try {
      if (isEdit) {
        await update.mutateAsync({
          coupleName: name,
          eventDate: eventDate.trim(),
          venue: venue.trim(),
          expiryDate: expiryDate ? new Date(`${expiryDate}T00:00:00Z`).toISOString() : null,
        });
        toast.success("Album updated.");
        onOpenChange(false);
      } else {
        const created = await create.mutateAsync({
          coupleName: name,
          eventDate: eventDate.trim() || undefined,
          venue: venue.trim() || undefined,
          expiryDate: expiryDate ? new Date(`${expiryDate}T00:00:00Z`).toISOString() : undefined,
        });
        toast.success("Album created.");
        onOpenChange(false);
        onCreated?.(created.albumId);
      }
    } catch (e) {
      setError((e as { message?: string })?.message ?? "Could not save album.");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit album" : "New album"}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Update the names and details printed for this album."
              : "Start with the couple — you will add photos and videos next."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="album-couple">Couple name *</Label>
            <Input
              id="album-couple"
              value={coupleName}
              onChange={(e) => setCoupleName(e.target.value)}
              placeholder="e.g. Meera & Arjun"
              maxLength={120}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="album-date">Event date</Label>
              <Input
                id="album-date"
                value={eventDate}
                onChange={(e) => setEventDate(e.target.value)}
                placeholder="e.g. 12 February 2026"
                maxLength={60}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="album-expiry">Auto-delete on</Label>
              <Input
                id="album-expiry"
                type="date"
                value={expiryDate}
                onChange={(e) => setExpiryDate(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="album-venue">Venue</Label>
            <Input
              id="album-venue"
              value={venue}
              onChange={(e) => setVenue(e.target.value)}
              placeholder="e.g. Kalyana Mandapam, Mylapore"
              maxLength={160}
            />
          </div>
          {error && (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={pending}>
            {pending ? "Saving…" : isEdit ? "Save changes" : "Create album"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
