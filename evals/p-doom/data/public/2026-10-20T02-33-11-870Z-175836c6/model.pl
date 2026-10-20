0.5::adv_cap.
0.050000000000000003::misaligned_takeover.
0.34999999999999998::takeover_mass_lethal.
0.55000000000000004::bio_uplift.
0.080000000000000002::bio_attack.
0.080000000000000002::bio_defense_fails.
0.025000000000000001::ai_escalation_war.
0.29999999999999999::war_mass_lethal.
bio_capable :- bio_uplift.
bio_capable :- adv_cap.
bio_catastrophe :- bio_capable, bio_attack, bio_defense_fails.
takeover_catastrophe :- adv_cap, misaligned_takeover, takeover_mass_lethal.
war_catastrophe :- adv_cap, ai_escalation_war, war_mass_lethal.
p_doom :- takeover_catastrophe.
p_doom :- bio_catastrophe.
p_doom :- war_catastrophe.
query(bio_capable).
query(bio_catastrophe).
query(p_doom).
query(takeover_catastrophe).
query(war_catastrophe).
