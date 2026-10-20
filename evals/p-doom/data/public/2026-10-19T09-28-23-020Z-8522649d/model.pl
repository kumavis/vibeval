0.59999999999999998::operational_reach.
0.20000000000000001::control_failure.
0.69999999999999996::bio_capacity.
0.14999999999999999::bio_human.
0.34999999999999998::bio_agent.
0.12::bio_fatal.
0.75::nuclear_access.
0.029999999999999999::nuclear_human.
0.14999999999999999::nuclear_agent.
0.29999999999999999::nuclear_fatal.
0.10000000000000001::physical_human.
0.40000000000000002::physical_agent.
0.080000000000000002::physical_fatal.
autonomous_power :- operational_reach, control_failure.
bio_outbreak :- bio_capacity, bio_human.
bio_outbreak :- bio_capacity, autonomous_power, bio_agent.
nuclear_war :- nuclear_access, nuclear_human.
nuclear_war :- nuclear_access, autonomous_power, nuclear_agent.
physical_crisis :- operational_reach, physical_human.
physical_crisis :- autonomous_power, physical_agent.
p_doom :- bio_outbreak, bio_fatal.
p_doom :- nuclear_war, nuclear_fatal.
p_doom :- physical_crisis, physical_fatal.
query(autonomous_power).
query(bio_outbreak).
query(nuclear_war).
query(p_doom).
query(physical_crisis).
