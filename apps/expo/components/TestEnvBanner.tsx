/**
 * Warns, on screen, that this build is pointed at the ONCHAIN TEST contract set
 * rather than the real Roebel DAO.
 *
 * Renders null in every production build, so it is safe to mount unconditionally.
 * It exists because the test CitizenNFT cannot be told apart from the real one by
 * name -- CitizenNFTv2 hardcodes its ERC721 name, so only the address differs, and an
 * address is exactly what nobody reads. Without this strip a staging build looks
 * identical to production while minting worthless citizenship.
 */
import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { identityContractSet } from "@/constants/identity-contract-set";

export default function TestEnvBanner() {
  if (!identityContractSet.isTest) return null;

  const short = `${identityContractSet.citizenNFT.slice(0, 6)}…${identityContractSet.citizenNFT.slice(-4)}`;
  return (
    <View style={styles.container}>
      <View style={styles.banner}>
        <Text style={styles.icon}>🧪</Text>
        <View style={styles.textContainer}>
          <Text style={styles.title}>
            Test-Bürger-Pass · keine reale Berechtigung
          </Text>
          <Text style={styles.subtitle}>
            Keine kommunale Entscheidung, Abstimmungs- oder Zahlungsbefugnis.
            Vertrag: {short}
          </Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { paddingHorizontal: 16, paddingTop: 12 },
  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 12,
    borderRadius: 12,
    backgroundColor: "#FEF3C7",
    borderWidth: 1,
    borderColor: "#F59E0B",
  },
  icon: { fontSize: 18 },
  textContainer: { flex: 1 },
  title: { fontSize: 14, fontWeight: "700", color: "#92400E" },
  subtitle: { fontSize: 12, color: "#B45309", marginTop: 2 },
});
