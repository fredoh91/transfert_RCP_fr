import pino from 'pino';
import path from 'path';
const logDirectory = path.join(__dirname, '..', 'log');
const transport = pino.transport({
    targets: [
        {
            target: 'pino/file',
            options: {
                destination: `${logDirectory}/transf_RCP_fr_${new Date().getFullYear()}_${String(new Date().getMonth() + 1).padStart(2, '0')}.log`,
                mkdir: true,
            },
        },
        {
            target: 'pino-pretty',
            options: {
                colorize: true,
            },
        },
    ],
});
const logger = pino({
    level: 'info',
    timestamp: () => `,"time":"${new Date().toLocaleString('fr-FR', { timeZone: 'Europe/Paris' })}"`,
}, transport);
export default logger;
