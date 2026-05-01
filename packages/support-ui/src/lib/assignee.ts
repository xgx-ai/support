export interface IssueAssignee {
	login: string;
	name?: string | null;
	avatar_url?: string | null;
	assigned_at?: string | null;
}

export interface IssueWithAssignees {
	assignee?: IssueAssignee | null;
	assignees?: IssueAssignee[];
	assigned_at?: string | null;
}

export function getAssigneeInitials(login: string): string {
	return login.slice(0, 2).toUpperCase();
}

export function getAssigneeDisplayName(assignee: IssueAssignee): string {
	return assignee.name?.trim() || assignee.login;
}

export function getIssueAssignees(issue: IssueWithAssignees): IssueAssignee[] {
	const assignees: IssueAssignee[] = [];
	const seen = new Set<string>();
	const add = (assignee?: IssueAssignee | null) => {
		if (!assignee || seen.has(assignee.login)) return;
		seen.add(assignee.login);
		assignees.push(assignee);
	};

	add(issue.assignee);
	for (const assignee of issue.assignees ?? []) {
		add(assignee);
	}

	return assignees;
}

export function getAssignedAt(
	issue: IssueWithAssignees,
	assignee: IssueAssignee,
): string | null {
	return (
		assignee.assigned_at ??
		(issue.assignee?.login === assignee.login ? issue.assigned_at : null) ??
		null
	);
}

export function getWorkStartedAt(issue: IssueWithAssignees): string | null {
	const assignedDates = getIssueAssignees(issue)
		.map((assignee) => getAssignedAt(issue, assignee))
		.filter((value): value is string => Boolean(value));

	if (assignedDates.length === 0) {
		return issue.assigned_at ?? null;
	}

	return assignedDates.reduce((earliest, current) =>
		new Date(current).getTime() < new Date(earliest).getTime()
			? current
			: earliest,
	);
}
