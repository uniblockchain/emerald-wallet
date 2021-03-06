/* eslint-disable import/no-extraneous-dependencies */
import thunkMiddleware from 'redux-thunk';
import createReduxLogger from 'redux-logger';
import { createStore as createReduxStore, applyMiddleware, combineReducers } from 'redux';
import { reducer as formReducer } from 'redux-form';
import { ipcRenderer } from 'electron';

import { api } from '../lib/rpc/api';

import history from './wallet/history';
import accounts from './vault/accounts';
import network from './network';
import screen from './wallet/screen';
import settings from './wallet/settings';
import tokens from './vault/tokens';

// import { loadAddressBook } from './addressActions';
// import { loadTokenList } from './tokenActions';
// import { loadContractList } from './contractActions';
import { readConfig, listenElectron, connecting, loadClientVersion } from './launcher/launcherActions';
import { watchConnection as waitLedger, setWatch, setBaseHD } from './ledgerActions';
import addressReducers from './addressReducers';
import tokenReducers from './vault/tokens/tokenReducers';
import contractReducers from './contractReducers';
import launcherReducers from './launcher/launcherReducers';
import ledgerReducers from './ledgerReducers';
import walletReducers from './wallet/walletReducers';
import deployedTokens from '../lib/deployedTokens';

import createLogger from '../utils/logger';

const log = createLogger('store');

const second = 1000;
const minute = 60 * second;
export const intervalRates = {
    second, // (whilei) this must be the newfangled object-shorthand...?
    minute,
    // (whilei: development: loading so often slows things a lot for me and clutters logs; that's why I have
    // stand-in times here for development)
    // Continue is repeating timeouts.
    continueLoadSyncRate: minute, // prod: second
    continueLoadHeightRate: 5 * minute, // prod: 5 * second
    continueRefreshAllTxRate: 60 * second, // prod: 2 * second
    continueRefreshLongRate: 900 * second, // 5 o'clock somewhere.
};

const stateTransformer = (state) => ({
    accounts: state.accounts.toJS(),
    addressBook: state.addressBook.toJS(),
    tokens: state.tokens.toJS(),
    contracts: state.contracts.toJS(),
    network: state.network.toJS(),
    launcher: state.launcher.toJS(),
    ledger: state.ledger.toJS(),
    form: state.form,
    wallet: {
        history: state.wallet.history.toJS(),
        screen: state.wallet.screen.toJS(),
        settings: state.wallet.settings.toJS(),
    },
});

const loggerMiddleware = createReduxLogger({
    stateTransformer,
});

const reducers = {
    accounts: accounts.reducer,
    addressBook: addressReducers,
    tokens: tokenReducers,
    contracts: contractReducers,
    network: network.reducer,
    launcher: launcherReducers,
    ledger: ledgerReducers,
    form: formReducer,
    wallet: walletReducers,
};

/**
 * Creates Redux store with API as dependency injection.
 *
 * Injecting api allows to write unit tests.
 *
 * @param _api
 */
export const createStore = (_api) => createReduxStore(
    combineReducers(reducers),
    applyMiddleware(
        thunkMiddleware.withExtraArgument(_api),
        loggerMiddleware
    )
);

export const store = createStore(api);

function refreshAll() {
    store.dispatch(accounts.actions.loadPendingTransactions());
    store.dispatch(history.actions.refreshTrackedTransactions());
    store.dispatch(network.actions.loadHeight());
    store.dispatch(accounts.actions.loadAccountsList());

    const state = store.getState();
    if (state.launcher.getIn(['geth', 'type']) === 'local') {
        store.dispatch(network.actions.loadPeerCount());
    }
    setTimeout(refreshAll, intervalRates.continueRefreshAllTxRate);
}

function refreshLong() {
    store.dispatch(settings.actions.getExchangeRates());
    setTimeout(refreshLong, intervalRates.continueRefreshLongRate);
}

export function startSync() {
    store.dispatch(network.actions.getGasPrice());
    store.dispatch(loadClientVersion());
    // store.dispatch(loadAddressBook());
    // store.dispatch(loadTokenList());
    // store.dispatch(loadContractList());

    const state = store.getState();

    const chain = state.launcher.getIn(['chain', 'name']);

    if (chain === 'mainnet') {
        store.dispatch(setBaseHD("44'/61'/0'/0"));
    } else if (chain === 'morden') {
        // FIXME ledger throws "Invalid status 6804" for 44'/62'/0'/0
        store.dispatch(setBaseHD("44'/61'/1'/0"));
    }

    if (state.launcher.getIn(['geth', 'type']) !== 'remote') {
        // check for syncing
        setTimeout(() => store.dispatch(network.actions.loadSyncing()), intervalRates.second); // prod: intervalRates.second
        // double check for syncing
        setTimeout(() => store.dispatch(network.actions.loadSyncing()), 2 * intervalRates.minute); // prod: 30 * this.second
    }

    const chainId = state.launcher.getIn(['chain', 'id']);
    store.dispatch(history.actions.init(chainId));

    // deployed tokens
    const known = deployedTokens[+chainId];
    if (known) {
        known.forEach((token) => store.dispatch(tokens.actions.addToken(token)));
    }

    refreshAll();
    setTimeout(refreshLong, 3 * intervalRates.second);
    store.dispatch(connecting(false));
}

export function stopSync() {
    // TODO
}

export function start() {
    try {
        store.dispatch(readConfig());
        store.dispatch(settings.actions.loadSettings());
    } catch (e) {
        log.error(e);
    }
    store.dispatch(listenElectron());
    store.dispatch(screen.actions.gotoScreen('welcome'));
}

export function waitForServices() {
    const unsubscribe = store.subscribe(() => {
        const state = store.getState();
        if (state.launcher.get('terms') === 'v1'
            && state.launcher.getIn(['geth', 'status']) === 'ready'
            && state.launcher.getIn(['connector', 'status']) === 'ready') {
            unsubscribe();
            log.info('All services are ready to use by Wallet');
            startSync();
            // If not first run, go right to home when ready.
            if (state.wallet.screen.get('screen') === 'welcome') { //  && !state.launcher.get('firstRun'))
                store.dispatch(screen.actions.gotoScreen('home'));
            }
        }
    });

    function checkServiceStatus() {
        ipcRenderer.send('get-status');
    }
    setTimeout(checkServiceStatus, 2000);
}

export function waitForServicesRestart() {
    store.dispatch(connecting(true));
    const unsubscribe = store.subscribe(() => {
        const state = store.getState();
        if (state.launcher.getIn(['geth', 'status']) !== 'ready'
            || state.launcher.getIn(['connector', 'status']) !== 'ready') {
            unsubscribe();
            waitForServices();
        }
    });
}

export function screenHandlers() {
    let prevScreen = null;
    const unsubscribe = store.subscribe(() => {
        const state = store.getState();
        const curScreen = state.wallet.screen.get('screen');
        const justOpened = prevScreen !== curScreen;
        prevScreen = curScreen;
        if (justOpened) {
            if (curScreen === 'create-tx' || curScreen === 'add-from-ledger') {
                store.dispatch(setWatch(true));
                store.dispatch(waitLedger());
            } else {
                store.dispatch(setWatch(false));
            }
        }
    });
}

waitForServices();
screenHandlers();
