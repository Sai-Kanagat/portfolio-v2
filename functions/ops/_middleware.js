// Gate for the /ops dashboard shell and its assets. Fails closed.
import { guard } from '../_lib/access.js';
export const onRequest = (context) => guard(context, { api: false });
