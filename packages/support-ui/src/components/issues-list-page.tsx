import { useQueryClient } from "@tanstack/solid-query";
import type { ColumnDef } from "@tanstack/solid-table";
import {
	Badge,
	Button,
	Card,
	Flex,
	TableColumnHeader,
	TableInfinite,
	Text,
	Toolbar,
	ToolbarGroup,
	ToolbarSearch,
	ToolbarSpacer,
	useResponseDialog,
	useTableInfinite,
} from "@xgx/ui";
import { MessageSquare, Plus } from "@xgx/ui/icons";
import { createSignal, type JSX, onCleanup, Show, Suspense } from "solid-js";
import { filterNonPriorityLabels, getPriority } from "../lib/priority";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Issue {
	number: number;
	title: string;
	state: string;
	created_at: string;
	comments: number;
	labels: { name: string; color: string }[];
}

type Envelope<T> = { data: T | null; error: string | null };

type IssueState = "open" | "closed";

export interface IssuesListPageProps {
	/** Fetch issues list. */
	listIssues: (input: {
		state: IssueState;
		page: number;
		perPage: number;
	}) => Promise<Envelope<Issue[]>>;

	/** Navigate to an issue detail page. */
	onNavigateToIssue: (issueNumber: number) => void;

	/** Query key builders. */
	queryKeys: {
		all: readonly unknown[];
		list: (state?: string) => readonly unknown[];
	};

	/** Optional date formatter. Defaults to `en-GB` short date. */
	formatDate?: (iso: string) => string;

	/**
	 * Optional transform applied to the fetched issues list before display.
	 * Useful for sorting (e.g. blocked issues to top).
	 */
	transformIssues?: (issues: Issue[]) => Issue[];

	/**
	 * Optional extra columns to insert before the "Created" column.
	 * e.g. a "Status" column.
	 */
	extraColumns?: ColumnDef<Issue, unknown>[];

	/**
	 * Render the create issue dialog content.
	 */
	renderCreateDialog: (dialogProps: {
		resolve: (value: boolean) => void;
		reject: (reason?: unknown) => void;
	}) => JSX.Element;

	/** Optional header element to show above the card. Defaults to "Support" title. */
	header?: JSX.Element;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const defaultFormatDate = (iso: string) =>
	new Date(iso).toLocaleDateString("en-GB", {
		day: "numeric",
		month: "short",
		year: "numeric",
	});

export function IssuesListPage(props: IssuesListPageProps) {
	const queryClient = useQueryClient();
	const { showResponseDialog, DialogResponse } = useResponseDialog();
	const fmt = () => props.formatDate ?? defaultFormatDate;

	const [state, setState] = createSignal<IssueState>("open");
	const [searchValue, setSearchValue] = createSignal("");
	const [debouncedSearch, setDebouncedSearch] = createSignal("");
	let debounceTimer: ReturnType<typeof setTimeout> | undefined;

	onCleanup(() => {
		if (debounceTimer) clearTimeout(debounceTimer);
	});

	const handleSearchChange = (value: string) => {
		setSearchValue(value);
		if (debounceTimer) clearTimeout(debounceTimer);
		debounceTimer = setTimeout(() => setDebouncedSearch(value), 300);
	};

	const baseColumns: ColumnDef<Issue, unknown>[] = [
		{
			accessorKey: "title",
			meta: { displayName: "Title" },
			header: (ctx) => (
				<TableColumnHeader
					title="Title"
					sortable
					sorted={ctx.column.getIsSorted()}
					onSort={ctx.column.getToggleSortingHandler()}
				/>
			),
			cell: (info) => {
				const row = info.row.original;
				return (
					<Flex align="center" gap="2">
						<Text as="span" size="xs" weight="medium">
							{row.title}
						</Text>
						<Text as="span" size="xs" class="text-muted-foreground">
							#{row.number}
						</Text>
					</Flex>
				);
			},
			enableSorting: true,
		},
		{
			id: "priority",
			meta: { displayName: "Priority" },
			header: () => <TableColumnHeader title="Priority" />,
			cell: (info) => {
				const priority = getPriority(info.row.original.labels);
				return (
					<Badge
						variant="outline"
						class="font-normal text-xxs"
						style={{ "border-color": priority.color, color: priority.color }}
					>
						{priority.displayText}
					</Badge>
				);
			},
			enableSorting: false,
			size: 100,
		},
		{
			id: "labels",
			meta: { displayName: "Labels" },
			header: () => <TableColumnHeader title="Labels" />,
			cell: (info) => {
				const labels = filterNonPriorityLabels(info.row.original.labels);
				return (
					<Show
						when={labels.length > 0}
						fallback={
							<Text as="span" size="xs" class="text-muted-foreground">
								—
							</Text>
						}
					>
						<Flex gap="1" class="flex-wrap">
							{labels.map((label) => (
								<Badge
									variant="outline"
									class="font-normal text-xxs"
									style={{ "border-color": `#${label.color}` }}
								>
									{label.name}
								</Badge>
							))}
						</Flex>
					</Show>
				);
			},
			enableSorting: false,
			enableHiding: true,
		},
		...(props.extraColumns ?? []),
		{
			accessorKey: "comments",
			meta: { displayName: "Comments" },
			header: () => <TableColumnHeader title="Comments" />,
			cell: (info) => {
				const count = info.getValue() as number;
				return (
					<Flex align="center" gap="1.5" class="text-muted-foreground">
						<MessageSquare class="size-3.5" />
						<Text as="span" size="xs">
							{count}
						</Text>
					</Flex>
				);
			},
			enableSorting: false,
			size: 100,
		},
		{
			accessorKey: "created_at",
			meta: { displayName: "Created" },
			header: (ctx) => (
				<TableColumnHeader
					title="Created"
					sortable
					sorted={ctx.column.getIsSorted()}
					onSort={ctx.column.getToggleSortingHandler()}
				/>
			),
			cell: (info) => (
				<Text as="span" size="xs" class="text-muted-foreground">
					{fmt()(info.getValue() as string)}
				</Text>
			),
			enableSorting: true,
			size: 140,
		},
	];

	const PAGE_SIZE = 100;

	const table = useTableInfinite<Issue>({
		tableId: "support-issues",
		queryKey: () => [...props.queryKeys.list(state()), debouncedSearch()],
		queryFn: async ({ page }) => {
			const result = await props.listIssues({
				state: state(),
				page: page + 1,
				perPage: PAGE_SIZE,
			});
			if (result.error || !result.data) {
				return { data: [], count: 0, totalCount: 0 };
			}
			let items = result.data;
			const search = debouncedSearch().toLowerCase();
			if (search) {
				items = items.filter(
					(i) =>
						i.title.toLowerCase().includes(search) ||
						String(i.number).includes(search),
				);
			}
			if (props.transformIssues) {
				items = props.transformIssues(items);
			}
			return { data: items, count: items.length, totalCount: items.length };
		},
		limit: PAGE_SIZE,
	});

	const handleRowClick = (row: Issue) => {
		props.onNavigateToIssue(row.number);
	};

	const handleNewIssue = async () => {
		const result = await showResponseDialog({
			title: "New Issue",
			description: "Submit a bug report or feature request.",
			class: "max-w-lg w-full",
			content: (dialogProps: {
				resolve: (value: boolean) => void;
				reject: (reason?: unknown) => void;
			}) => props.renderCreateDialog(dialogProps),
		});

		if (result) {
			queryClient.invalidateQueries({
				queryKey: props.queryKeys.all,
			});
		}
	};

	return (
		<>
			{props.header ?? (
				<Flex justify="between" align="center" class="mb-2.5 shrink-0">
					<Text class="text-xs font-medium text-foreground">Support</Text>
				</Flex>
			)}

			<Card padding="md" class="flex-1 flex flex-col min-h-0">
				<Toolbar class="mb-4 p-0 bg-transparent border-none shrink-0">
					<ToolbarGroup>
						<ToolbarSearch
							placeholder="Search issues..."
							class="w-64 max-w-none"
							value={searchValue()}
							onInput={handleSearchChange}
						/>
						<Flex gap="1">
							<Button
								variant={state() === "open" ? "default" : "outline"}
								size="sm"
								onClick={() => setState("open")}
							>
								Open
							</Button>
							<Button
								variant={state() === "closed" ? "default" : "outline"}
								size="sm"
								onClick={() => setState("closed")}
							>
								Closed
							</Button>
						</Flex>
					</ToolbarGroup>

					<ToolbarSpacer />

					<Button variant="default" onClick={handleNewIssue}>
						<Plus class="size-4" />
						New Issue
					</Button>
				</Toolbar>

				<Suspense>
					<TableInfinite
						table={table}
						columns={baseColumns}
						getRowId={(row: Issue) => String(row.number)}
						enableSorting
						enableColumnVisibility
						onRowClick={handleRowClick}
					/>
				</Suspense>
			</Card>

			<DialogResponse />
		</>
	);
}
