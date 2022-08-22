import {isTruthy, safeMatch} from 'augment-vir';
import {runShellCommand} from 'augment-vir/dist/cjs/node-only';
import {basename} from 'path';
import {askQuestion} from '../wait-for-cli-input';

const second = 1000;
const minute = 60 * second;
const hour = 60 * minute;
const day = 24 * hour;
const month = day * 30;

const staleBranchAge = 3 * month;
const staleBranchDate = new Date(Date.now() - staleBranchAge);

const mergedBranchAge = 14 * day;
const mergedBranchDate = new Date(Date.now() - mergedBranchAge);

type BranchNameWithDate = {
    name: string;
    lastCommitDate: Date;
};

const ignoreTheseBranches = [
    'main',
    'master',
    'staging',
    'production',
];

async function deleteStaleAndMergedBranches(contextDir: string) {
    await pruneRemote(contextDir);

    const remoteBranchNames = filterOutKeyBranchNames(await getAllRemoteBranches(contextDir));
    const mergedBranchNames = filterOutKeyBranchNames(await getAllMergedRemoteBranches(contextDir));

    const remoteBranchesWithDates = await getBranchDates(contextDir, remoteBranchNames);

    const staleBranchesToDelete = filterToBranchesModifiedSinceDate(
        remoteBranchesWithDates,
        staleBranchDate,
    );

    const staleBranchNames = new Set<string>(staleBranchesToDelete.map((branch) => branch.name));

    const mergedBranchesWithDates = (await getBranchDates(contextDir, mergedBranchNames)).filter(
        (branch) => !staleBranchNames.has(branch.name),
    );
    const mergedBranchesToDelete = filterToBranchesModifiedSinceDate(
        mergedBranchesWithDates,
        mergedBranchDate,
    );

    const userResponse = await waitForUserToAccept(staleBranchesToDelete, mergedBranchesToDelete);

    if (userResponse === 'yes') {
        await deleteBranches(contextDir, [
            ...staleBranchesToDelete,
            ...mergedBranchesToDelete,
        ]);
        console.info('\ndone.');
    } else {
        console.info('Branches not deleted: user declined to proceed.');
        process.exit(0);
    }
}

function filterOutKeyBranchNames(branchNames: string[]): string[] {
    return branchNames.filter((branchName) => !ignoreTheseBranches.includes(branchName));
}

async function waitForUserToAccept(
    staleBranches: readonly BranchNameWithDate[],
    mergedBranches: readonly BranchNameWithDate[],
) {
    console.info(`\n\n${staleBranches.length} stale branches to delete:\n`);
    console.info(branchesToNameDateLogString(staleBranches));
    console.info(`\n\n${mergedBranches.length} merged branches to delete:\n`);
    console.info(branchesToNameDateLogString(mergedBranches));
    console.info(`\n${staleBranches.length} stale branches will be deleted.`);
    console.info(`\n${mergedBranches.length} merged branches will be deleted.`);
    console.info(`Stale branch date off: ${staleBranchDate.toDateString()}`);
    console.info(`Merged branch date cutoff: ${mergedBranchDate.toDateString()}`);

    const response = await askQuestion(
        'Are you sure you want to delete all these? (Type "yes" and hit enter to proceed.) ',
    );

    return response;
}

function branchesToNameDateLogString(branches: readonly BranchNameWithDate[]): string {
    return branches
        .map((staleBranch) => {
            return `\x1b[91m${
                staleBranch.name
            }\x1b[37m: Last modified on \x1b[96m${staleBranch.lastCommitDate.toDateString()}\x1b[0m`;
        })
        .join('\n');
}

function filterToBranchesModifiedSinceDate(
    branchesWithDates: BranchNameWithDate[],
    modifiedDate: Date,
): BranchNameWithDate[] {
    return branchesWithDates
        .filter((gitBranch) => {
            return Number(modifiedDate) > Number(gitBranch.lastCommitDate);
        })
        .sort((a, b) => Number(a.lastCommitDate) - Number(b.lastCommitDate));
}

async function getBranchDates(
    contextDir: string,
    branchNames: string[],
): Promise<BranchNameWithDate[]> {
    return await Promise.all(
        branchNames.map(async (branchName) => {
            const lastCommitDate = await getLastCommitDateOfBranch(contextDir, branchName);
            if (!lastCommitDate || !Number(lastCommitDate)) {
                throw new Error(
                    `Failed to get last commit date for branch ${branchName}: ${lastCommitDate}`,
                );
            }
            return {
                name: branchName,
                lastCommitDate: lastCommitDate,
            };
        }),
    );
}

async function deleteBranches(contextDir: string, branches: BranchNameWithDate[]): Promise<void> {
    await Promise.all(
        branches.map(async (branch) => {
            await deleteBranch(contextDir, branch.name);
        }),
    );
}

async function deleteBranch(contextDir: string, branchName: string): Promise<void> {
    await runShellCommand(`git push origin --delete ${branchName}`, {
        hookUpToConsole: true,
        rejectOnError: true,
        cwd: contextDir,
    });
}

async function getLastCommitDateOfBranch(contextDir: string, branchName: string): Promise<Date> {
    const fetchResult = await runShellCommand(`git fetch origin ${branchName}`, {
        cwd: contextDir,
        rejectOnError: true,
    });

    if (fetchResult.exitCode) {
        throw new Error(fetchResult.stderr);
    }

    const scriptResult = await runShellCommand(`git show -s --format=%ct origin/${branchName}`, {
        cwd: contextDir,
        rejectOnError: true,
    });

    if (scriptResult.exitCode) {
        throw new Error(scriptResult.stderr);
    }

    const loggedTimestamp = scriptResult.stdout.trim();

    const numericTimestamp = Number(loggedTimestamp);

    if (isNaN(numericTimestamp)) {
        throw new Error(`Failed to extract numeric timestamp from "${loggedTimestamp}"`);
    }

    return new Date(numericTimestamp * 1000);
}

async function getAllMergedRemoteBranches(contextDir: string): Promise<string[]> {
    const results = await runShellCommand('git branch -r --merged', {
        cwd: contextDir,
        rejectOnError: true,
    });

    const lines = results.stdout.split('\n');
    const branchNames = lines
        .filter(isTruthy)
        .map((line) => {
            const branchName = safeMatch(line, /^\s*[^\/]+\/(.+)$/)[1];
            if (!branchName) {
                throw new Error(`Failed to extract branch name from "${line}"`);
            }
            return branchName;
        })
        .filter(isTruthy);

    return branchNames;
}

async function getAllRemoteBranches(contextDir: string): Promise<string[]> {
    const scriptResult = await runShellCommand('git ls-remote --heads origin', {
        cwd: contextDir,
        rejectOnError: true,
    });

    const lines = scriptResult.stdout.split('\n').filter(isTruthy);
    const branchNames = lines
        .map((line) => {
            const branchName = safeMatch(line, /^[\d\w]+\s+refs\/heads\/(.+)$/)[1];
            if (!branchName) {
                throw new Error(`Failed to extract branch name from "${line}"`);
            }
            return branchName;
        })
        .filter(isTruthy);

    return branchNames;
}

async function pruneRemote(contextDir: string): Promise<void> {
    await runShellCommand(`git remote prune origin`, {
        cwd: contextDir,
        rejectOnError: true,
    });
}

function getRelevantArguments(): string[] {
    const thisFileName = basename(__filename);
    const thisFileNameWithoutExtension = thisFileName.replace(/\.ts$/, '');
    const thisScriptIndex = process.argv.findIndex(
        (argv) => !!argv.match(new RegExp(`${thisFileNameWithoutExtension}\.(?:ts|js)$`)),
    );
    if (thisScriptIndex < 0) {
        throw new Error(`Failed to find index of script in ${process.argv}`);
    }
    return process.argv.slice(thisScriptIndex + 1);
}

if (require.main === module) {
    const relevantArgs = getRelevantArguments();
    const gitDir = relevantArgs[0] ?? process.cwd();
    console.info(`Using directory: ${gitDir}`);
    deleteStaleAndMergedBranches(gitDir).catch((error) => {
        console.error(error);
        process.exit(1);
    });
}
