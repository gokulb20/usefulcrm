"use client";

import * as React from "react";
import * as ContextMenuPrimitive from "@radix-ui/react-context-menu";
import { ChevronRightIcon, CheckIcon } from "lucide-react";
import { cn } from "@/lib/utils";

function ContextMenu({
	...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Root>) {
	return <ContextMenuPrimitive.Root data-slot="context-menu" {...props} />;
}

function ContextMenuTrigger({
	className,
	...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Trigger>) {
	return (
		<ContextMenuPrimitive.Trigger
			data-slot="context-menu-trigger"
			className={cn("select-none", className)}
			{...props}
		/>
	);
}

function ContextMenuGroup({
	...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Group>) {
	return (
		<ContextMenuPrimitive.Group data-slot="context-menu-group" {...props} />
	);
}

function ContextMenuPortal({
	...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Portal>) {
	return (
		<ContextMenuPrimitive.Portal data-slot="context-menu-portal" {...props} />
	);
}

function ContextMenuSub({
	...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Sub>) {
	return <ContextMenuPrimitive.Sub data-slot="context-menu-sub" {...props} />;
}

function ContextMenuRadioGroup({
	...props
}: React.ComponentProps<typeof ContextMenuPrimitive.RadioGroup>) {
	return (
		<ContextMenuPrimitive.RadioGroup
			data-slot="context-menu-radio-group"
			{...props}
		/>
	);
}

function ContextMenuContent({
	className,
	...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Content>) {
	return (
		<ContextMenuPrimitive.Portal>
			<ContextMenuPrimitive.Content
				data-slot="context-menu-content"
				className={cn(
					"bg-neutral-100/[0.67] dark:bg-neutral-900/[0.67] border border-white dark:border-white/10 backdrop-blur-md text-[var(--color-text)] z-[9999] max-h-[var(--radix-context-menu-content-available-height)] min-w-[8rem] overflow-x-hidden overflow-y-auto rounded-3xl p-1 shadow-[0_0_25px_0_rgba(0,0,0,0.16)] outline-none",
					"data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
					className,
				)}
				{...props}
			/>
		</ContextMenuPrimitive.Portal>
	);
}

function ContextMenuItem({
	className,
	inset,
	variant = "default",
	...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Item> & {
	inset?: boolean;
	variant?: "default" | "destructive";
}) {
	return (
		<ContextMenuPrimitive.Item
			data-slot="context-menu-item"
			data-inset={inset}
			data-variant={variant}
			className={cn(
				"bg-transparent hover:bg-neutral-400/15 focus:bg-neutral-400/15 text-sm transition-all relative flex cursor-pointer items-center gap-2 rounded-full px-2 py-1.5 outline-none select-none",
				"data-[variant=destructive]:text-[var(--color-error)] data-[variant=destructive]:hover:bg-[var(--color-error)]/10 data-[variant=destructive]:focus:bg-[var(--color-error)]/10 data-[variant=destructive]:hover:text-[var(--color-error)]",
				inset && "pl-8",
				"[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
				"data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
				className,
			)}
			{...props}
		/>
	);
}

function ContextMenuSubTrigger({
	className,
	inset,
	children,
	...props
}: React.ComponentProps<typeof ContextMenuPrimitive.SubTrigger> & {
	inset?: boolean;
}) {
	return (
		<ContextMenuPrimitive.SubTrigger
			data-slot="context-menu-sub-trigger"
			data-inset={inset}
			className={cn(
				"bg-transparent hover:bg-neutral-400/15 focus:bg-neutral-400/15 data-[state=open]:bg-neutral-400/15 flex cursor-pointer items-center gap-2 rounded-full px-2 py-1.5 text-sm outline-none select-none transition-all",
				inset && "pl-8",
				"[&_svg:not([class*='text-'])]:text-[var(--color-text-muted)] [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
				className,
			)}
			{...props}
		>
			{children}
			<ChevronRightIcon className="ml-auto size-4" />
		</ContextMenuPrimitive.SubTrigger>
	);
}

function ContextMenuSubContent({
	className,
	...props
}: React.ComponentProps<typeof ContextMenuPrimitive.SubContent>) {
	return (
		<ContextMenuPrimitive.SubContent
			data-slot="context-menu-sub-content"
			className={cn(
				"bg-neutral-100/[0.67] dark:bg-neutral-900/[0.67] border border-white dark:border-white/10 backdrop-blur-md text-[var(--color-text)] z-[9999] min-w-[96px] overflow-hidden rounded-3xl p-1 shadow-[0_0_25px_0_rgba(0,0,0,0.16)] outline-none",
				"data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
				className,
			)}
			{...props}
		/>
	);
}

function ContextMenuCheckboxItem({
	className,
	children,
	checked,
	inset,
	...props
}: React.ComponentProps<typeof ContextMenuPrimitive.CheckboxItem> & {
	inset?: boolean;
}) {
	return (
		<ContextMenuPrimitive.CheckboxItem
			data-slot="context-menu-checkbox-item"
			data-inset={inset}
			className={cn(
				"hover:bg-neutral-400/15 focus:bg-neutral-400/15 relative flex cursor-pointer items-center gap-2 rounded-full py-1.5 pr-2 pl-8 text-sm outline-none select-none transition-colors",
				inset && "pl-8",
				"[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
				"data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
				className,
			)}
			checked={checked}
			{...props}
		>
			<span className="pointer-events-none absolute left-2 flex size-3.5 items-center justify-center">
				<ContextMenuPrimitive.ItemIndicator>
					<CheckIcon className="size-4" />
				</ContextMenuPrimitive.ItemIndicator>
			</span>
			{children}
		</ContextMenuPrimitive.CheckboxItem>
	);
}

function ContextMenuRadioItem({
	className,
	children,
	inset,
	...props
}: React.ComponentProps<typeof ContextMenuPrimitive.RadioItem> & {
	inset?: boolean;
}) {
	return (
		<ContextMenuPrimitive.RadioItem
			data-slot="context-menu-radio-item"
			data-inset={inset}
			className={cn(
				"hover:bg-neutral-400/15 focus:bg-neutral-400/15 relative flex cursor-pointer items-center gap-2 rounded-full py-1.5 pr-2 pl-8 text-sm outline-none select-none transition-colors",
				inset && "pl-8",
				"[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
				"data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
				className,
			)}
			{...props}
		>
			<span className="pointer-events-none absolute left-2 flex size-3.5 items-center justify-center">
				<ContextMenuPrimitive.ItemIndicator>
					<CheckIcon className="size-4" />
				</ContextMenuPrimitive.ItemIndicator>
			</span>
			{children}
		</ContextMenuPrimitive.RadioItem>
	);
}

function ContextMenuLabel({
	className,
	inset,
	...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Label> & {
	inset?: boolean;
}) {
	return (
		<ContextMenuPrimitive.Label
			data-slot="context-menu-label"
			data-inset={inset}
			className={cn(
				"px-2 py-1.5 text-sm font-medium",
				inset && "pl-8",
				className,
			)}
			{...props}
		/>
	);
}

function ContextMenuSeparator({
	className,
	...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Separator>) {
	return (
		<ContextMenuPrimitive.Separator
			data-slot="context-menu-separator"
			className={cn("bg-neutral-400/15 -mx-1 my-1 h-px", className)}
			{...props}
		/>
	);
}

function ContextMenuShortcut({
	className,
	...props
}: React.ComponentProps<"span">) {
	return (
		<span
			data-slot="context-menu-shortcut"
			className={cn(
				"text-[var(--color-text-muted)] ml-auto text-xs tracking-widest",
				className,
			)}
			{...props}
		/>
	);
}

export {
	ContextMenu,
	ContextMenuTrigger,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuCheckboxItem,
	ContextMenuRadioItem,
	ContextMenuLabel,
	ContextMenuSeparator,
	ContextMenuShortcut,
	ContextMenuGroup,
	ContextMenuPortal,
	ContextMenuSub,
	ContextMenuSubContent,
	ContextMenuSubTrigger,
	ContextMenuRadioGroup,
};
