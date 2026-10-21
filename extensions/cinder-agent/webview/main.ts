import type { HostMessage } from '../src/protocol';
import { ChatScreen } from './chat';
import { renderHome } from './home';
import './styles.css';
import { post } from './vscode';

const app = document.getElementById('app')!;
const mode = document.documentElement.dataset.mode === 'home' ? 'home' : 'chat';
const markUrl = app.dataset.mark ?? '';
const chat = mode === 'chat' ? new ChatScreen(app) : undefined;

window.addEventListener('message', (event: MessageEvent<HostMessage>) => {
	const message = event.data;
	switch (message.type) {
		case 'home':
			if (mode === 'home') {
				renderHome(app, message.state, markUrl);
			}
			break;
		case 'conversation':
			chat?.show(message.state);
			break;
		case 'conversations':
			chat?.showList(message.state);
			break;
		case 'upsert':
			chat?.upsert(message.item);
			break;
		case 'appendText':
			chat?.appendText(message.id, message.text);
			break;
		case 'busy':
			chat?.setBusy(message.busy);
			break;
		case 'title':
			chat?.setTitle(message.title);
			break;
	}
});

post({ type: 'ready' });
