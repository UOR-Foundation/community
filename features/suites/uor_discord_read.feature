Feature: uor_discord_read

  This repository's Prism application, in app/, built by the Prism-DevRel
  builder from its prompt set: Permit the read-only collector to read a UOR Foundation Discord channel only when it is a text or forum channel everyone can view, the Foundation labels it public, a server administrator installed the bot and the Message Content intent is granted.

  @UDR-01 @build
  Scenario: The app never answers permit when kind is dm
    Given the model in app/src/UorDiscordRead.lex.tex
    When the Lean kernel checks inv001Holds during prismpm verify
    Then no request meets breaksInv001

  @UDR-02 @build
  Scenario: The app never answers permit when visibility is restricted
    Given the model in app/src/UorDiscordRead.lex.tex
    When the Lean kernel checks inv002Holds during prismpm verify
    Then no request meets breaksInv002

  @UDR-03 @build
  Scenario: The app never answers permit when label is not public
    Given the model in app/src/UorDiscordRead.lex.tex
    When the Lean kernel checks inv003Holds during prismpm verify
    Then no request meets breaksInv003

  @UDR-04 @build
  Scenario: The app never answers permit when install is other
    Given the model in app/src/UorDiscordRead.lex.tex
    When the Lean kernel checks inv004Holds during prismpm verify
    Then no request meets breaksInv004

  @UDR-05 @build
  Scenario: The app never answers permit when intent is missing
    Given the model in app/src/UorDiscordRead.lex.tex
    When the Lean kernel checks inv005Holds during prismpm verify
    Then no request meets breaksInv005
