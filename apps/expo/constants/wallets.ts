import { inAppWallet } from 'thirdweb/wallets/in-app';
import { chain } from './thirdweb';
import { gnosis } from './gnosis';
import * as Linking from 'expo-linking';

export const redirectUrl = Linking.createURL('/profile');

export const wallets = [
  inAppWallet({
    auth: {
      options: ['email', 'phone', 'google', 'facebook', 'apple'],
      redirectUrl,
    },
    smartAccount: {
      chain,
      sponsorGas: true,
    },
  }),
];

// Parallel wallet pointed at Gnosis for Röbel Münzen (Circles). Same in-app login
// (auto-connects the shared session, no re-auth) → deterministically the SAME
// smart-account address as Base. sponsorGas:true (Gnosis enabled in the thirdweb
// sponsorship policy) → fully gasless, no xDAI seeding needed.
export const gnosisWallet = inAppWallet({
  auth: {
    options: ['email', 'phone', 'google', 'facebook', 'apple'],
    redirectUrl,
  },
  smartAccount: {
    chain: gnosis,
    sponsorGas: true,
  },
});
