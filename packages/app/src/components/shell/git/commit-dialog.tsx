"use client";

import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@multi/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPopup,
  DialogTitle,
} from "@multi/ui/dialog";

export function CommitDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCommit: (input: { message: string; push?: boolean }) => Promise<void>;
}) {
  const [msg, setMsg] = useState("");
  const [push, setPush] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const trimmed = msg.trim();
    if (!trimmed) return;
    setBusy(true);
    setErr(null);
    try {
      await props.onCommit({ message: trimmed, push });
      toast.success(push ? "Committed and pushed" : "Changes committed");
      setMsg("");
      setPush(false);
      props.onOpenChange(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => {
        if (!open) {
          setErr(null);
          setBusy(false);
        }
        props.onOpenChange(open);
      }}
    >
      <DialogPopup className="max-w-md" showCloseButton>
        <DialogHeader>
          <DialogTitle>Commit changes</DialogTitle>
          <DialogDescription>Stage all changes and create a single commit.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3 px-6 py-4">
          <textarea
            value={msg}
            onChange={(e) => setMsg(e.target.value)}
            placeholder="Commit message"
            rows={3}
            className="w-full resize-none rounded-multi-control border border-multi-border/60 bg-transparent px-3 py-2 text-body text-foreground outline-none transition-colors placeholder:text-muted-foreground/50 focus:border-primary/60"
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void submit();
              }
            }}
          />
          <label className="flex items-center gap-2 text-detail text-foreground/80">
            <input
              type="checkbox"
              checked={push}
              onChange={(e) => setPush(e.target.checked)}
              className="size-3.5 rounded border-multi-border/60 accent-primary"
            />
            Push after commit
          </label>
          {err ? <p className="text-detail text-destructive/90">{err}</p> : null}
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => props.onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" disabled={!msg.trim() || busy} onClick={() => void submit()}>
            {busy ? "Committing..." : "Commit"}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

export function BranchCommitDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCommit: (input: { message: string; push?: boolean }) => Promise<void>;
}) {
  const [msg, setMsg] = useState("");
  const [push, setPush] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const trimmed = msg.trim();
    if (!trimmed) return;
    setBusy(true);
    setErr(null);
    try {
      await props.onCommit({ message: trimmed, push });
      toast.success("Branch created and committed");
      setMsg("");
      setPush(false);
      props.onOpenChange(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => {
        if (!open) {
          setErr(null);
          setBusy(false);
        }
        props.onOpenChange(open);
      }}
    >
      <DialogPopup className="max-w-md" showCloseButton>
        <DialogHeader>
          <DialogTitle>Create branch & commit</DialogTitle>
          <DialogDescription>
            Create a new branch, stage all changes, and commit. The branch name is generated
            automatically.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3 px-6 py-4">
          <textarea
            value={msg}
            onChange={(e) => setMsg(e.target.value)}
            placeholder="Commit message"
            rows={3}
            className="w-full resize-none rounded-multi-control border border-multi-border/60 bg-transparent px-3 py-2 text-body text-foreground outline-none transition-colors placeholder:text-muted-foreground/50 focus:border-primary/60"
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void submit();
              }
            }}
          />
          <label className="flex items-center gap-2 text-detail text-foreground/80">
            <input
              type="checkbox"
              checked={push}
              onChange={(e) => setPush(e.target.checked)}
              className="size-3.5 rounded border-multi-border/60 accent-primary"
            />
            Push after commit
          </label>
          {err ? <p className="text-detail text-destructive/90">{err}</p> : null}
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => props.onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" disabled={!msg.trim() || busy} onClick={() => void submit()}>
            {busy ? "Creating..." : "Create & Commit"}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
