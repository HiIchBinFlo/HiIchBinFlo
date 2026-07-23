import { AlertCircle, AlertTriangle, CheckCircle2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { useUiStore } from "@/stores/uiStore";
import { useProjectStore } from "@/stores/projectStore";
import { validateProject } from "@/lib/validation";

export function ValidationDialog() {
  const open = useUiStore((s) => s.isValidationDialogOpen);
  const setDialog = useUiStore((s) => s.setDialog);
  const items = useProjectStore((s) => s.state.items);
  const dlcs = useProjectStore((s) => s.state.dlcs);
  const select = useUiStore((s) => s.select);

  const issues = validateProject(items, dlcs);

  return (
    <Dialog open={open} onOpenChange={(v) => setDialog("validation", v)}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Validation</DialogTitle>
          <DialogDescription>
            Checked for missing files, broken references, duplicate ids, and invalid metadata.
          </DialogDescription>
        </DialogHeader>

        {issues.length === 0 ? (
          <p className="flex items-center gap-2 rounded-md bg-success/10 p-3 text-sm text-success">
            <CheckCircle2 className="h-4 w-4" /> No issues found. This project is ready to export.
          </p>
        ) : (
          <ScrollArea className="h-80">
            <div className="space-y-1.5 pr-3">
              {issues.map((issue) => (
                <button
                  key={issue.id}
                  onClick={() => {
                    if (issue.itemId) {
                      select(issue.itemId);
                      setDialog("validation", false);
                    }
                  }}
                  className="flex w-full items-start gap-2 rounded-md border border-border p-2 text-left text-xs hover:bg-accent"
                >
                  {issue.severity === "error" ? (
                    <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
                  ) : (
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
                  )}
                  <span className="flex-1">{issue.message}</span>
                  <Badge variant="outline" className="shrink-0 font-mono">
                    {issue.code}
                  </Badge>
                </button>
              ))}
            </div>
          </ScrollArea>
        )}
      </DialogContent>
    </Dialog>
  );
}
