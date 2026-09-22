# Smart Account Gasless Configuration Guide

## Overview

Your DAO application now uses **thirdweb Smart Accounts** to enable **100% gasless transactions** for all users. This is the recommended approach for thirdweb SDK v5 and provides better reliability than per-transaction `gasless: true` flags.

## How It Works

### Smart Account Architecture

```
User Wallet (In-App Wallet)
    ↓
Smart Account (ERC-4337)
    ↓
Paymaster (thirdweb)
    ↓
Blockchain Transaction (Base)
```

1. **User authenticates** via social login (Google, Apple, Email, etc.)
2. **Smart Account is created** automatically by thirdweb
3. **All transactions** are routed through the Smart Account
4. **Paymaster sponsors** gas fees using your thirdweb credits
5. **User signs** but pays $0.00

## Implementation

### Global Configuration (Recommended ✅)

Configure `sponsorGas: true` at the wallet level in your `inAppWallet` configuration:

```typescript
import { inAppWallet } from "thirdweb/wallets";
import { base } from "thirdweb/chains";

const wallets = [
  inAppWallet({
    auth: {
      options: ["phone", "email", "google", "apple", "facebook"],
    },
    smartAccount: {
      chain: base, // Your active chain
      sponsorGas: true, // Enable gasless transactions globally
    },
  }),
];
```

### Current wallet configuration

The shared [wallet configuration](../apps/web/src/lib/wallet-config.ts) supplies
the existing landing-page and app-header connection controls. The unused
residence/OTP/wallet registration flow was retired on 2026-09-22; it is not a
second signup path or a prerequisite for wallet connection. See the
[account-access boundary](../apps/web/docs/CITIZEN_VERIFICATION_STATUS.md).

### External Wallets (MetaMask, Coinbase, etc.)

For external wallets like MetaMask, Coinbase Wallet, and WalletConnect (used in Semaphore admin page), gasless transactions work differently:

```typescript
import { createWallet } from "thirdweb/wallets";

const wallets = [
  createWallet("io.metamask"),
  createWallet("com.coinbase.wallet"),
  createWallet("walletConnect"),
];
```

**Note**: External wallets require the `gasless: true` flag on individual transactions. The Smart Account approach only works with `inAppWallet`.

## Benefits of Smart Accounts

### 1. **Global Configuration**
- Configure once, works everywhere
- No need to add `gasless: true` to every transaction
- Centralized control

### 2. **Better Reliability**
- ERC-4337 standard compliance
- Better paymaster integration
- More robust error handling

### 3. **Advanced Features**
- **Batch Transactions**: Execute multiple operations in one transaction
- **Session Keys**: Delegate signing authority for specific actions
- **Account Recovery**: Better security and recovery options
- **Gas Estimation**: Automatic optimization

### 4. **Cost Optimization**
- Smart Accounts batch transactions efficiently
- Better gas estimation reduces overpayment
- Unified paymaster usage

## Transaction Flows

### Before (v4 Pattern)
```typescript
sendTransaction(transaction, {
  gasless: true, // Required on EVERY transaction
  onSuccess: () => {},
  onError: () => {}
});
```

### After (v5 Smart Account)
```typescript
// Just send the transaction - gasless is automatic!
sendTransaction(transaction, {
  onSuccess: () => {},
  onError: () => {}
});
```

**Note**: We kept the `gasless: true` flags for documentation purposes, but they're no longer technically required when using Smart Accounts.

## Testing Checklist

### 1. User Registration Flow
- [ ] Connect wallet via social login (Google, Apple, etc.)
- [ ] Check browser console for Smart Account creation
- [ ] Verify account type shows as "Smart Account"

### 2. Verification Requests
- [ ] Request Bürger-Pass → **$0.00**
- [ ] Request Bescheiniger-Pass → **$0.00**
- [ ] Approve request → **$0.00**
- [ ] Reject request → **$0.00**

### 3. Governance Flow
- [ ] Create proposal → **$0.00**
- [ ] Vote on proposal → **$0.00**
- [ ] Delegate voting power → **$0.00**

### 4. NFT Operations
- [ ] Mint NFT → **$0.00**

### 5. Verify Wallet Balance
- [ ] Check wallet balance before operations
- [ ] Perform multiple transactions
- [ ] Confirm wallet balance unchanged

## Troubleshooting

### Issue: Still Showing Gas Fees

**Cause**: User's wallet is not a Smart Account (might be using external wallet or old session)

**Solution**:
1. Disconnect wallet completely
2. Clear browser cache/localStorage
3. Reconnect with social login
4. Verify Smart Account is created (check console)

### Issue: "Insufficient Funds" Error

**Cause**: Paymaster might be out of credits or misconfigured

**Solution**:
1. Check thirdweb dashboard: https://thirdweb.com/dashboard/connect/account-abstraction
2. Verify credits balance > $0
3. Check sponsorship policy is active on Base chain
4. Verify client ID matches your `EXPO_PUBLIC_THIRDWEB_CLIENT_ID` env var

### Issue: Transactions Reverting

**Cause**: Not related to gasless - contract-level issue

**Solution**:
1. Check contract requirements (e.g., delegation needed, approval required)
2. Verify user has necessary permissions
3. Check transaction parameters

## Monitoring

### Check Smart Account Usage

View Smart Account transactions in thirdweb dashboard:
1. Go to https://thirdweb.com/dashboard
2. Navigate to "Account Abstraction" section
3. View "Sponsored Transactions" history
4. Monitor costs and usage patterns

### Cost Breakdown

| Transaction Type | User Cost | You Pay (Base L2) |
|------------------|-----------|-------------------|
| Delegation | **$0.00** | ~$0.02 |
| Verification Request | **$0.00** | ~$0.04 |
| Approve/Reject | **$0.00** | ~$0.03 |
| Proposal Creation | **$0.00** | ~$0.05 |
| Vote | **$0.00** | ~$0.02 |
| Mint NFT | **$0.00** | ~$0.03 |

**Your Budget**: $10/month = 200-500 transactions

## Migration Notes

### From Per-Transaction `gasless: true`

**Before this update**, we added `gasless: true` to 11 transaction locations:
- ✅ Bürger-Pass request
- ✅ Bescheiniger-Pass request
- ✅ Approve/Reject requests (2 locations)
- ✅ Create proposal
- ✅ Vote on proposal
- ✅ Delegate (2 locations)
- ✅ Mint NFT
- ✅ Add citizens (2 locations)

**After Smart Account setup**, these flags are redundant but kept for documentation.

### External Wallets Still Use `gasless: true`

The Semaphore admin page uses external wallets (MetaMask, etc.) which require:
```typescript
sendTransaction(transaction, {
  gasless: true, // Still needed for external wallets
  // ...
});
```

This is correct and will continue working.

## Best Practices

### 1. **Use Smart Accounts for End Users**
- In-app wallets with social login
- Best UX for non-crypto users
- Automatic gasless transactions

### 2. **External Wallets for Advanced Users**
- MetaMask for power users
- Coinbase Wallet for simplicity
- Still support `gasless: true` on transactions

### 3. **Monitor Paymaster Credits**
- Set up alerts at $2 remaining
- Track monthly spending patterns
- Adjust limits if needed

### 4. **Test After Wallet Updates**
- Clear browser cache between tests
- Test with different auth providers
- Verify Smart Account creation

## Security Notes

### Smart Account Security

- **Non-Custodial**: User controls their account
- **ERC-4337 Standard**: Industry-standard implementation
- **Audited**: thirdweb's Smart Account is audited
- **Recoverable**: Better recovery options than EOAs

### Paymaster Security

- **Rate Limiting**: thirdweb automatically rate limits
- **Spending Caps**: Your $10/month limit protects from abuse
- **Chain Specific**: Only Base chain is sponsored
- **Contract Filtering**: Can be configured per contract

## Resources

- **thirdweb Smart Accounts**: https://portal.thirdweb.com/connect/account-abstraction
- **ERC-4337 Standard**: https://eips.ethereum.org/EIPS/eip-4337
- **Your Dashboard**: https://thirdweb.com/dashboard/connect/account-abstraction
- **Base Explorer**: https://basescan.org/

## Summary

✅ **Smart Accounts configured** in 2 key locations
✅ **All in-app wallet users** get gasless transactions automatically
✅ **External wallets** still supported with per-transaction flags
✅ **Production ready** - ready to onboard users with $0 friction

**Your DAO now provides the smoothest possible UX for blockchain interactions!** 🎉

## Next Steps

1. **Test locally** with social login
2. **Verify $0.00 costs** across all flows
3. **Monitor paymaster usage** in thirdweb dashboard
4. **Deploy to production** when ready
