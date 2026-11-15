Feature: uor_990_return

  This repository's Prism application, in app/, built by the Prism-DevRel
  builder from its prompt set: Decide which of Form 990-N, Form 990-EZ and Form 990 a section 501(c)(3) public charity files for a tax year, from its normal gross receipts, its gross receipts and total assets for the year, and the special rules for supporting organizations, sponsoring organizations of donor advised funds and controlling organizations, as the 2025 Instructions for Form 990 state them. The answer is the shortest return the instructions permit; an organization may always file a longer one.

  @U9R-01 @build
  Scenario: The app never answers form990n when normally is large
    Given the model in app/src/Uor990Return.lex.tex
    When the Lean kernel checks inv001Holds during prismpm verify
    Then no request meets breaksInv001

  @U9R-02 @build
  Scenario: The app never answers form990n when kind is supporting
    Given the model in app/src/Uor990Return.lex.tex
    When the Lean kernel checks inv002Holds during prismpm verify
    Then no request meets breaksInv002

  @U9R-03 @build
  Scenario: The app always answers form990 when normally is large and receipts is large
    Given the model in app/src/Uor990Return.lex.tex
    When the Lean kernel checks inv003Holds during prismpm verify
    Then no request meets breaksInv003

  @U9R-04 @build
  Scenario: The app always answers form990 when normally is large and assets is large
    Given the model in app/src/Uor990Return.lex.tex
    When the Lean kernel checks inv004Holds during prismpm verify
    Then no request meets breaksInv004

  @U9R-05 @build
  Scenario: The app always answers form990ez when normally is large and receipts is small and assets is small and kind is public
    Given the model in app/src/Uor990Return.lex.tex
    When the Lean kernel checks inv005Holds during prismpm verify
    Then no request meets breaksInv005

  @U9R-06 @build
  Scenario: The app never answers form990ez when normally is large and kind is sponsor
    Given the model in app/src/Uor990Return.lex.tex
    When the Lean kernel checks inv006Holds during prismpm verify
    Then no request meets breaksInv006
