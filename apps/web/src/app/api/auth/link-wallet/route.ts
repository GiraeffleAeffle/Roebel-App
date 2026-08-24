import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import {
  isEvmWalletAddress,
  runStagingRouteMutation,
} from "@/lib/stadtstack/profile-write-boundary.mjs";

export async function POST(request: NextRequest) {
  // This legacy route cannot prove that the supplied Supabase user ID owns
  // the Thirdweb wallet. The read-only staging lab must reject it before
  // parsing attacker-controlled identity claims or touching Supabase.
  const guarded = await runStagingRouteMutation(
    process.env.NEXT_PUBLIC_STADTSTACK_STAGING_LAB,
    async () => {
      try {
        const body = await request.json();
        const { supabase_user_id, phone_number, wallet_address, auth_provider, email } = body;

        // Validate inputs
        if (!supabase_user_id || typeof supabase_user_id !== "string") {
          return NextResponse.json(
            { error: "Supabase user ID is required" },
            { status: 400 }
          );
        }

        if (!phone_number || typeof phone_number !== "string") {
          return NextResponse.json(
            { error: "Phone number is required" },
            { status: 400 }
          );
        }

        if (!isEvmWalletAddress(wallet_address)) {
          return NextResponse.json(
            { error: "Invalid wallet address format" },
            { status: 400 }
          );
        }

        // Check if wallet already exists in our users table
        const { data: existingUser } = await supabase
          .from("users")
          .select("*")
          .eq("wallet_address", wallet_address)
          .single();

        let userRecord;

        if (existingUser) {
          // Update existing user with phone number
          const { data: updatedUser, error: updateError } = await supabase
            .from("users")
            .update({
              phone_number: phone_number,
              phone_verified: true,
              phone_verified_at: new Date().toISOString(),
              verification_status: "pending",
              email: email || existingUser.email,
              auth_provider: auth_provider || existingUser.auth_provider,
              email_verified: email ? true : existingUser.email_verified,
              last_login_at: new Date().toISOString(),
            })
            .eq("wallet_address", wallet_address)
            .select()
            .single();

          if (updateError) {
            console.error("Failed to update user:", updateError);
            return NextResponse.json(
              { error: "Failed to update user record" },
              { status: 500 }
            );
          }

          userRecord = updatedUser;
        } else {
          // Create new user record
          const { data: newUser, error: insertError } = await supabase
            .from("users")
            .insert({
              wallet_address: wallet_address,
              phone_number: phone_number,
              phone_verified: true,
              phone_verified_at: new Date().toISOString(),
              verification_status: "pending",
              auth_provider: auth_provider || "social",
              email: email,
              email_verified: email ? true : false,
            })
            .select()
            .single();

          if (insertError) {
            console.error("Failed to create user:", insertError);
            return NextResponse.json(
              { error: "Failed to create user record" },
              { status: 500 }
            );
          }

          userRecord = newUser;
        }

        console.log("✅ Wallet linked successfully:", wallet_address);

        return NextResponse.json({
          success: true,
          message: "Wallet linked successfully",
          user: userRecord,
        });
      } catch (error) {
        console.error("Error in link wallet:", error);
        return NextResponse.json(
          { error: "Internal server error" },
          { status: 500 }
        );
      }
    },
  );
  if (!guarded.allowed) {
    return NextResponse.json(
      { error: guarded.error },
      { status: 403 },
    );
  }
  return guarded.value;
}
