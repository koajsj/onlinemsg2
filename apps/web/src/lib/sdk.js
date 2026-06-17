import { CbEvents, MessageType, OnlineState, Platform, SessionType, getSDK } from '@openim/client-sdk';

export const sdk = getSDK();

export const openimConfig = {
  apiAddr:
    import.meta.env.VITE_OPENIM_API ||
    `${window.location.origin}/openim-api`,
  wsAddr:
    import.meta.env.VITE_OPENIM_WS ||
    `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/openim-ws`,
  platformID: Platform.Web
};

export { CbEvents, MessageType, OnlineState, SessionType };
