import {collapseWhiteSpace, safeMatch} from 'augment-vir';
import {readdir, readFile} from 'fs/promises';
import {basename, join} from 'path';

type Endpoint = {
    type: string;
    path: string;
};

async function getExpressEndpoints(directory: string) {
    const routeFileNames = await readdir(directory);
    const routeFilePaths = routeFileNames.map((fileName) => join(directory, fileName));

    const endpoints = await routeFileNames.reduce(async (accumPromise, fileName, fileIndex) => {
        const accum = await accumPromise;
        const filePath = routeFilePaths[fileIndex];
        const fileEndpoints = await getFileEndpoints(filePath ?? '');
        accum[fileName] = fileEndpoints;
        return accum;
    }, Promise.resolve({} as Record<string, Endpoint[]>));
    console.info(formatEndpoints(endpoints));
}

function formatEndpoints(endpoints: Record<string, Endpoint[]>): string {
    return Object.keys(endpoints)
        .sort()
        .map((fileName) => {
            const title = ` * **${fileName}**`;
            const endPoints = endpoints[fileName]!.sort((a, b) => {
                return (a.type + a.path).localeCompare(b.type + b.path);
            });
            const endpointLines = endPoints
                .map((endpoint) => `\t* ${endpoint.type}: \`${endpoint.path}\``)
                .join('\n');
            return `${title}\n${endpointLines}`;
        })
        .join('\n');
}

async function getFileEndpoints(filePath: string): Promise<Endpoint[]> {
    if (!filePath) {
        throw new Error(`Got empty file path.`);
    }
    const fileLines = (await readFile(filePath)).toString().split('\n');
    const endpoints: Endpoint[] = [];

    fileLines.forEach((rawLine, index) => {
        const trimmedLine = rawLine.trim();
        if (trimmedLine.startsWith('app.')) {
            const method = safeMatch(trimmedLine, /app\.([^\(]+)\(/)[1] ?? '';
            const nextLine = fileLines[index + 1] ?? '';
            const combinedLines = collapseWhiteSpace(trimmedLine.concat(nextLine));
            const path = safeMatch(combinedLines, /\(\s*['"`]([^'"`]+)['"`]/)[1] ?? '';
            const newEndpoint: Endpoint = {
                type: method,
                path,
            };
            endpoints.push(newEndpoint);
        }
    });

    return endpoints;
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
    const contextDir = relevantArgs[0] ?? process.cwd();
    console.info(`Using dir "${contextDir}"`);
    getExpressEndpoints(contextDir).catch((error) => {
        console.error(error);
        process.exit(1);
    });
}
