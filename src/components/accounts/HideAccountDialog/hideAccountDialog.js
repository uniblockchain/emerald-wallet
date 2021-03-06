import React from 'react';
import { connect } from 'react-redux';
import { Dialog, IconButton } from 'material-ui';
import { CloseIcon } from 'elements/Icons';
import styles from './hideAccountDialog.scss';
import Button from 'elements/Button';
import { hideAccount } from 'store/vault/accounts/accountActions';
import { Warning, WarningHeader, WarningText } from 'elements/Warning';
import screen from '../../../store/wallet/screen';
import accounts from '../../../store/vault/accounts';
import history from '../../../store/wallet/history';

class HideAccountDialog extends React.Component {
    render() {
        const { onClose, handleConfirmHide, chain } = this.props;

        return (
            <Dialog modal={true} open={true} onRequestClose={ onClose } contentStyle={{maxWidth: '600px'}}>
                <div style={{width: '100%'}}>
                    <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
                        <div className={styles.title}>Are you Sure you want to hide this account?</div>
                        <div>
                            <IconButton
                                className={ styles.closeButton }
                                onTouchTap={ onClose }
                                tooltip="Close">
                                <CloseIcon/>
                            </IconButton>
                        </div>
                    </div>
                    <div style={{marginRight: '20px'}}>
                        <Warning>
                            <WarningHeader>Hiding accounts will NOT delete your wallet files.</WarningHeader>
                            <WarningText>This will only hide the account. If you really need to delete an account on disk, you can go through the CLI or go in and manually delete the wallet files.</WarningText>
                        </Warning>
                    </div>
                    <Button
                      style={{
                          marginTop: '10px'
                      }}
                      label="Yes"
                      primary={true}
                      onClick={handleConfirmHide} />
                    <Button
                      style={{
                          marginLeft: '10px',
                          marginTop: '10px'
                      }}
                      label="No"
                      onClick={ onClose } />
                </div>
            </Dialog>);
    }
}

export default connect(
  (state, ownProps) => ({
      address: ownProps.address
  }),
  (dispatch, ownProps) => ({
      handleConfirmHide: () => {
          dispatch(hideAccount(ownProps.address));

          // refresh account data
          dispatch(history.actions.refreshTrackedTransactions());
          dispatch(accounts.actions.loadAccountsList());
          dispatch(accounts.actions.loadPendingTransactions());

          dispatch(screen.actions.gotoScreen('home'));
      }
  })
)(HideAccountDialog);
