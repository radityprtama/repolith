import { cn } from "@/lib/utils";

export function Logo({ className }: { className?: string }) {
	return (
		<span className={cn("font-mono text-sm font-medium tracking-tight", className)}>
			BETTER-HUB.
		</span>
	);
}

export function LogoMark({ className }: { className?: string }) {
	return (
		<span className={cn("font-mono text-sm font-bold tracking-tight", className)}>
			b.
		</span>
	);
}
