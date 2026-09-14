import {
    StoryEntitySummary,
} from "@cosmos/contracts";
import {
    Badge,
} from "@/components/ui/badge";
import {
    Button,
} from "@/components/ui/button";
import {
    entityTypeLabel,
} from "@/components/cosmos/entity-panel";

export function EntityRow({
    link,
    busy,
    onUnlink,
}: {
    link: StoryEntitySummary;
    busy: boolean;
    onUnlink: (entityId: string) => Promise<void>;
}) {
    return (
        <li
            data-story-entity-id={link.entityId}
            className="flex flex-wrap items-center gap-2 border-t py-3 first:border-t-0"
        >
            <Badge variant="secondary">{entityTypeLabel(link.type)}</Badge>
            <span className="min-w-0 flex-1 truncate text-sm">{link.name}</span>
            <span className="text-xs text-muted-foreground">{link.entityId}</span>
            {link.actor && (
                <span className="text-xs text-muted-foreground">· {link.actor}</span>
            )}
            <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => void onUnlink(link.entityId)}
            >
                解除关联
            </Button>
        </li>
    );
}
