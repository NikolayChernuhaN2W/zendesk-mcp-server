import { ticketsTools } from './tickets.js';
import { usersTools } from './users.js';
import { organizationsTools } from './organizations.js';
import { groupsTools } from './groups.js';
import { macrosTools } from './macros.js';
import { viewsTools } from './views.js';
import { triggersTools } from './triggers.js';
import { automationsTools } from './automations.js';
import { searchTools } from './search.js';
import { helpCenterTools } from './help-center.js';
import { supportTools } from './support.js';
import { talkTools } from './talk.js';
import { chatTools } from './chat.js';
import { exportTools } from './export.js';

// Every tool the server offers, in registration order
export const allTools = [
  ...ticketsTools,
  ...usersTools,
  ...organizationsTools,
  ...groupsTools,
  ...macrosTools,
  ...viewsTools,
  ...triggersTools,
  ...automationsTools,
  ...searchTools,
  ...helpCenterTools,
  ...supportTools,
  ...talkTools,
  ...chatTools,
  ...exportTools
];
