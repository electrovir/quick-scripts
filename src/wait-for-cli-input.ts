import {createInterface} from 'readline';

export async function askQuestion(questionToAsk: string): Promise<string> {
    const cliInterface = createInterface({
        input: process.stdin,
        output: process.stdout,
    });

    return new Promise((resolve) =>
        cliInterface.question(questionToAsk, (ans) => {
            cliInterface.close();
            resolve(ans);
        }),
    );
}
